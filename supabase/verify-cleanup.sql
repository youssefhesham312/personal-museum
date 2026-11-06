-- Manual verification queries for the 7-day retention and cleanup job.
-- Run these in the Supabase SQL editor. They are read-only except where noted.
--
-- Photo bytes live in a private Cloudflare R2 bucket, so object counts cannot
-- be queried from Postgres. Check R2 in the Cloudflare dashboard (bucket ->
-- Objects, prefix `museums/<museum-id>/`) or with an S3-compatible client.
-- Never put R2 credentials in this SQL file or in the SQL editor.

-- 1. Museums that are past their expiry but may still be waiting for a run.
select id, public_id, created_at, expires_at, ready_at
  from public.museums
 where expires_at <= now()
 order by expires_at
 limit 50;

-- 2. Overall database counts.
select
  (select count(*) from public.museums) as museums,
  (select count(*) from public.museum_photos) as photo_rows,
  (select count(*) from public.museums where ready_at is null) as drafts;

-- 3. Photo rows grouped by museum (should be 5–15 per live museum).
select
  museum_id,
  count(*) as photos,
  pg_size_pretty(sum(byte_size)::bigint) as expected_r2_size
 from public.museum_photos
 group by museum_id
 order by museum_id;

-- 4. Photo rows whose parent museum row is missing. The foreign key with
--    ON DELETE CASCADE should make this impossible. It is a safety check only.
select p.id, p.museum_id, p.storage_path
  from public.museum_photos p
  left join public.museums m on m.id = p.museum_id
 where m.id is null;

-- 5. Object keys that belong to an expired museum and should disappear after
--    the next cleanup run. Useful when comparing against the R2 dashboard.
select id, public_id, expires_at, ready_at,
       (select count(*) from public.museum_photos p where p.museum_id = m.id) as photo_rows
  from public.museums m
 where expires_at <= now()
 order by expires_at;

-- 6. The hourly cron job and its recent runs.
select jobid, jobname, schedule, active
  from cron.job
 where jobname = 'museum-cleanup';

select jobid, runid, status, return_message, start_time, end_time
  from cron.job_run_details
 order by start_time desc
 limit 10;

-- pg_net responses (the cleanup endpoint returns a JSON summary).
select id, status_code, content, error_msg, created
  from net._http_response
 order by created desc
 limit 10;

-- 7. Manual expiry test (writes data).
--    Replace the public id, then wait for the hourly job or call the helper.
--
-- update public.museums
--    set expires_at = now() - interval '1 second'
--  where public_id = 'REPLACE_WITH_22_CHAR_PUBLIC_ID';
--
-- select public.trigger_museum_cleanup();
--
-- Re-run queries 1–5 afterwards: the museum row and its museum_photos rows
-- should be gone. Check the same museum prefix in the R2 dashboard: it should
-- contain no objects. If the row remains, the R2 delete failed and the next
-- hourly run will retry. If objects remain but the row is gone, that is an
-- orphan and needs manual removal.
