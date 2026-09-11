do $$
declare
  marketing_job_id bigint;
begin
  select jobid
    into marketing_job_id
    from cron.job
   where jobname = 'pocket-kpi-marketing-sync';

  if marketing_job_id is null then
    raise exception 'cron job pocket-kpi-marketing-sync not found';
  end if;

  perform cron.alter_job(
    job_id := marketing_job_id,
    schedule := '0 0 * * *'
  );
end
$$;
