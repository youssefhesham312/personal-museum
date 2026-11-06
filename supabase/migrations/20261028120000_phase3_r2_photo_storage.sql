-- Phase 3 — Cloudflare R2 photo storage.
--
-- Photo bytes are no longer written to Supabase Storage. The museum-api Edge
-- Function talks to a private R2 bucket through its S3-compatible API and
-- returns short-lived presigned PUT/GET URLs. Postgres still owns every piece
-- of museum metadata, retention, rate limiting and the cleanup schedule.
--
-- `public.museum_photos.storage_path` is kept (renaming or dropping it would
-- rewrite existing rows for no benefit). It now contains an R2 object key of
-- the form `museums/<museum-id>/<position>-<suffix>.<ext>`.
--
-- This migration is non-destructive:
--   * it removes the Supabase Storage access policy used by the old code;
--   * it removes the legacy `museum-photos` bucket only when that bucket is
--     completely empty, so existing photo bytes are never deleted;
--   * if the legacy bucket still contains objects, it is left in place for
--     manual review. Those objects are no longer read by the application.

comment on column public.museum_photos.storage_path is
  'Cloudflare R2 object key: museums/<museum-id>/<position>-<suffix>.<ext>. Not a Supabase Storage path.';

comment on table public.museum_photos is
  'Ordered photo metadata. Image bytes live in the private Cloudflare R2 bucket configured by R2_BUCKET.';

-- The old function used this policy with the service role to create signed
-- Storage URLs. Nothing in the application uses Supabase Storage now.
drop policy if exists "museum photos service role" on storage.objects;

do $$
begin
  if exists (
    select 1
      from storage.buckets
     where id = 'museum-photos'
  ) then
    if not exists (
      select 1
        from storage.objects
       where bucket_id = 'museum-photos'
    ) then
      delete from storage.buckets where id = 'museum-photos';
      raise notice 'Removed the empty legacy museum-photos bucket.';
    else
      raise notice
        'Legacy museum-photos bucket was kept because it is not empty. Remove it manually after confirming its objects are no longer needed.';
    end if;
  end if;
end;
$$;