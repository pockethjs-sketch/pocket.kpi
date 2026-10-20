-- 08:00 KST (23:00 UTC) daily refresh of upcoming CRM premeetings for the buildup workspace overview.
-- Reuses the existing internal-schedule credentials in Vault (project Edge JWT for the gateway and the internal
-- cron secret); the function URL is derived from the stored marketing function URL. cron.schedule replaces a job
-- with the same name, so re-running this is idempotent.
select cron.schedule(
  'pocket-buildup-premeetings',
  '0 23 * * *',
  $job$
    select net.http_post(
      url := replace((select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_function_url' limit 1),
        '/functions/v1/kpi-marketing-sync', '/functions/v1/kpi-buildup-premeetings'),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
        'x-kpi-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_cron_secret' limit 1)
      ),
      body := jsonb_build_object('trigger','cron'),
      timeout_milliseconds := 120000
    );
  $job$
);
