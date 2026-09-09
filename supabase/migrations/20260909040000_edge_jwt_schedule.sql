begin;

create or replace function public.kpi_configure_marketing_schedule(
  p_function_url text,
  p_cron_secret text,
  p_anon_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_job bigint;
begin
  if p_function_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/kpi-marketing-sync$'
    or length(coalesce(p_cron_secret,'')) < 32
    or length(coalesce(p_anon_key,'')) < 80 then raise exception 'invalid_schedule_config'; end if;
  select id into v_id from vault.secrets where name='kpi_marketing_function_url' limit 1;
  if v_id is null then perform vault.create_secret(p_function_url,'kpi_marketing_function_url','Pocket KPI marketing Edge URL');
  else perform vault.update_secret(v_id,p_function_url,'kpi_marketing_function_url','Pocket KPI marketing Edge URL'); end if;
  v_id := null;
  select id into v_id from vault.secrets where name='kpi_marketing_cron_secret' limit 1;
  if v_id is null then perform vault.create_secret(p_cron_secret,'kpi_marketing_cron_secret','Pocket KPI marketing cron auth');
  else perform vault.update_secret(v_id,p_cron_secret,'kpi_marketing_cron_secret','Pocket KPI marketing cron auth'); end if;
  v_id := null;
  select id into v_id from vault.secrets where name='kpi_marketing_anon_key' limit 1;
  if v_id is null then perform vault.create_secret(p_anon_key,'kpi_marketing_anon_key','Pocket KPI public Edge JWT');
  else perform vault.update_secret(v_id,p_anon_key,'kpi_marketing_anon_key','Pocket KPI public Edge JWT'); end if;
  for v_job in select jobid from cron.job where jobname='pocket-kpi-marketing-sync' loop perform cron.unschedule(v_job); end loop;
  v_job := cron.schedule('pocket-kpi-marketing-sync','0 */6 * * *',$job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_function_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
        'x-kpi-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_cron_secret' limit 1)
      ),
      body := jsonb_build_object('action','sync')
    );
  $job$);
  return jsonb_build_object('ok',true,'jobId',v_job,'schedule','every_6_hours','jwtVerified',true);
end;
$$;

revoke all on function public.kpi_configure_marketing_schedule(text,text,text) from public,anon,authenticated;
grant execute on function public.kpi_configure_marketing_schedule(text,text,text) to service_role;

commit;
