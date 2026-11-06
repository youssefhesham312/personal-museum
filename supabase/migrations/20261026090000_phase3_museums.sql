-- Phase 3 — museums, photos, retention and access rules.
--
-- Apply this migration before deploying the museum-api Edge Function.
-- The browser never talks to these tables directly: all reads and writes go
-- through the Edge Function, which holds the service-role key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.museums (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  title text not null,
  recipient_name text not null,
  dedication text not null default '',
  final_message text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ready_at timestamptz,
  completion_token_hash text not null,

  constraint museums_public_id_format check (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint museums_title_length check (char_length(title) between 1 and 200),
  constraint museums_recipient_length check (char_length(recipient_name) between 1 and 200),
  constraint museums_dedication_length check (char_length(dedication) <= 2000),
  constraint museums_final_message_length check (char_length(final_message) <= 4000),
  constraint museums_completion_hash_format check (completion_token_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.museums is
  'One gift museum. Rows are created by the museum-api Edge Function only.';
comment on column public.museums.public_id is
  '22-character unguessable share id. This is the only identifier the recipient sees.';
comment on column public.museums.expires_at is
  'Server-side expiry, seven days after created_at. Never supplied by a browser.';
comment on column public.museums.ready_at is
  'Null until every upload has been verified. Read access requires a value.';
comment on column public.museums.completion_token_hash is
  'SHA-256 of the one-time creator capability. The plaintext is never stored.';

create table if not exists public.museum_photos (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null references public.museums (id) on delete cascade,
  position smallint not null,
  storage_path text not null unique,
  content_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  caption text not null default '',
  date_label text not null default '',
  created_at timestamptz not null default now(),

  constraint museum_photos_position_range check (position between 0 and 14),
  constraint museum_photos_content_type check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint museum_photos_byte_size check (byte_size between 1 and 2097152),
  constraint museum_photos_width check (width between 1 and 8192),
  constraint museum_photos_height check (height between 1 and 8192),
  constraint museum_photos_caption_length check (char_length(caption) <= 400),
  constraint museum_photos_date_length check (char_length(date_label) <= 120),
  constraint museum_photos_unique_position unique (museum_id, position)
);

comment on table public.museum_photos is
  'Ordered photo metadata. The image bytes live in the private museum-photos bucket.';

create table if not exists public.creation_events (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now(),

  constraint creation_events_hash_format check (ip_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.creation_events is
  'Best-effort creation rate limiting. Only a salted hash of the client IP is stored.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists museums_expires_at_idx
  on public.museums (expires_at);

create index if not exists museums_abandoned_idx
  on public.museums (created_at)
  where ready_at is null;

create index if not exists creation_events_ip_created_idx
  on public.creation_events (ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Server-controlled retention
-- ---------------------------------------------------------------------------

create or replace function public.museums_apply_retention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  maximum_expiry timestamptz;
begin
  if tg_op = 'INSERT' then
    -- The browser cannot choose a creation time or an expiry time. An
    -- insertion may only shorten the default (used by maintenance/tests).
    new.created_at := now();
    maximum_expiry := new.created_at + interval '7 days';
    new.expires_at := least(coalesce(new.expires_at, maximum_expiry), maximum_expiry);
    new.ready_at := null;
  else
    -- Identity and the one-time capability are immutable. Expiry can be
    -- shortened by a privileged maintenance call, never extended.
    new.id := old.id;
    new.public_id := old.public_id;
    new.completion_token_hash := old.completion_token_hash;
    new.created_at := old.created_at;
    new.expires_at := least(coalesce(new.expires_at, old.expires_at), old.expires_at);
  end if;

  return new;
end;
$$;

drop trigger if exists museums_apply_retention on public.museums;
create trigger museums_apply_retention
  before insert or update on public.museums
  for each row execute function public.museums_apply_retention();

create or replace function public.museums_assert_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  photo_count integer;
begin
  if new.ready_at is not null and (tg_op = 'INSERT' or old.ready_at is null) then
    select count(*) into photo_count
      from public.museum_photos
     where museum_id = new.id;

    if photo_count < 5 or photo_count > 15 then
      raise exception 'A museum must have between 5 and 15 photographs before it can be shared.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists museums_assert_ready on public.museums;
create trigger museums_assert_ready
  before update of ready_at on public.museums
  for each row execute function public.museums_assert_ready();

-- Photos can be prepared while a museum is a draft, but cannot be added to or
-- changed once the museum has been shared. DELETE is intentionally allowed so
-- the ON DELETE CASCADE from cleanup keeps working.
create or replace function public.museum_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_ready timestamptz;
begin
  select ready_at into parent_ready
    from public.museums
   where id = new.museum_id;

  if parent_ready is not null then
    raise exception 'Photographs cannot be added to or changed in a museum that has already been shared.';
  end if;

  return new;
end;
$$;

drop trigger if exists museum_photos_guard on public.museum_photos;
create trigger museum_photos_guard
  before insert or update on public.museum_photos
  for each row execute function public.museum_photos_guard();

-- ---------------------------------------------------------------------------
-- Creation rate limiting (called only by the Edge Function)
-- ---------------------------------------------------------------------------

create or replace function public.consume_creation_slot(p_ip_hash text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid rate limit';
  end if;

  -- Serialize concurrent creations from the same hashed IP.
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));

  delete from public.creation_events
   where created_at < now() - interval '1 hour';

  select count(*) into used
    from public.creation_events
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if used >= p_limit then
    return false;
  end if;

  insert into public.creation_events (ip_hash) values (p_ip_hash);
  return true;
end;
$$;

revoke all on function public.consume_creation_slot(text, integer) from public;
revoke all on function public.consume_creation_slot(text, integer) from anon, authenticated;
grant execute on function public.consume_creation_slot(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- There are deliberately no policies for anon or authenticated. The share
-- link is not a database credential: the Edge Function validates the public id
-- and expiry, then returns only that museum's data and short-lived photo URLs.
-- ---------------------------------------------------------------------------

alter table public.museums enable row level security;
alter table public.museum_photos enable row level security;
alter table public.creation_events enable row level security;

revoke all on table public.museums from public;
revoke all on table public.museum_photos from public;
revoke all on table public.creation_events from public;
revoke all on table public.museums from anon, authenticated;
revoke all on table public.museum_photos from anon, authenticated;
revoke all on table public.creation_events from anon, authenticated;
revoke all on sequence public.creation_events_id_seq from public;
revoke all on sequence public.creation_events_id_seq from anon, authenticated;

grant all on table public.museums to service_role;
grant all on table public.museum_photos to service_role;
grant all on table public.creation_events to service_role;
grant usage, select on sequence public.creation_events_id_seq to service_role;

drop policy if exists "service role manages museums" on public.museums;
create policy "service role manages museums"
  on public.museums
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages museum photos" on public.museum_photos;
create policy "service role manages museum photos"
  on public.museum_photos
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages creation events" on public.creation_events;
create policy "service role manages creation events"
  on public.creation_events
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Private Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'museum-photos',
  'museum-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Signed upload/download URLs are created with the service role. No policy is
-- created for anon or authenticated, so a request without a signed URL cannot
-- list, read, write or delete objects in this bucket.
drop policy if exists "museum photos service role" on storage.objects;
create policy "museum photos service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'museum-photos')
  with check (bucket_id = 'museum-photos');
