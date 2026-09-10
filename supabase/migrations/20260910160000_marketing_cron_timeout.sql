begin;

do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'pocket-kpi-marketing-sync' loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'pocket-kpi-marketing-sync',
    '0 */6 * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_function_url' limit 1),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
          'x-kpi-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_cron_secret' limit 1)
        ),
        body := jsonb_build_object('action','sync'),
        timeout_milliseconds := 120000
      );
    $job$
  );
end;
$$;

commit;
