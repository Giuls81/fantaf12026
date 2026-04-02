-- 1. Enable Required Extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Prevent duplicate cron jobs if running multiple times
SELECT cron.unschedule('sync_fanta_f1_openf1');

-- 3. Schedule the Cron Job to run every 2 minutes
-- It uses pg_net to POST to our Edge Function endpoint.
SELECT cron.schedule(
  'sync_fanta_f1_openf1',
  '*/2 * * * *', -- Every 2 minutes
  $$
    SELECT net.http_post(
        url:='https://laqjyqfnjnofmvgedunl.supabase.co/functions/v1/fanta-api/cron/sync-all',
        headers:='{"Content-Type": "application/json", "cron-secret": "fanta-cron-2026"}'::jsonb
    ) as request_id;
  $$
);
