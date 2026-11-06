-- Phase 3 — hourly cleanup schedule.
--
-- Run this AFTER enabling the pg_cron, pg_net and Vault extensions in the
-- Supabase Dashboard (Database → Extensions) and after storing the three
-- Vault secrets described in SUPABASE-SETUP.md:
--
--   museum_cleanup_url     https://<project-ref>.supabase.co/functions/v1/museum-api/cleanup
--   museum_cleanup_secret  the same value as the Edge Function's MUSEUM_CLEANUP_SECRET
--   museum_anon_key        the project's public anon/publishable key
--
-- The cleanup endpoint still requires the secret header; pg_cron never holds
-- the service-role key.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_museum_cleanup()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cleanup_url text;
  cleanup_secret text;
  anon_key text;
  request_id bigint;
begin
  select decrypted_secret into cleanup_url
    from vault.decrypted_secrets
   where name = 'museum_cleanup_url';

  select decrypted_secret into cleanup_secret
    from vault.decrypted_secrets
   where name = 'museum_cleanup_secret';

  select decrypted_secret into anon_key
    from vault.decrypted_secrets
   where name = 'museum_anon_key';

  if cleanup_url is null or cleanup_secret is null or anon_key is null then
    raise notice
      'Museum cleanup skipped: configure the vault secrets museum_cleanup_url, museum_cleanup_secret and museum_anon_key.';
    return null;
  end if;

  select net.http_post(
    url := cleanup_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key,
      'x-cleanup-secret', cleanup_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.trigger_museum_cleanup() from public;
revoke all on function public.trigger_museum_cleanup() from anon, authenticated;
grant execute on function public.trigger_museum_cleanup() to service_role;

-- Replace an existing job so reapplying this migration is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'museum-cleanup') then
    perform cron.unschedule('museum-cleanup');
  end if;
end;
$$;

-- Every hour at :17. The endpoint processes a bounded batch, so a backlog
-- drains over several runs instead of timing out.
select cron.schedule(
  'museum-cleanup',
  '17 * * * *',
  $$select public.trigger_museum_cleanup();$$
);
