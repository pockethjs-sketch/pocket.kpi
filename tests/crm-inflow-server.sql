-- Synthetic database integration checks. Always roll back; return counts only.
begin;
do $$
declare
  org uuid := gen_random_uuid();
  run uuid := gen_random_uuid();
  result jsonb;
  after_state jsonb;
  rev text;
  protected jsonb := '{"id":"crm-910002","projNo":920002,"company":"Synthetic only","createdAt":"","calendarOnly":true,"channel":"CRM 캘린더","status":"계약 완료","contractAmount":1000,"paid":500,"payments":[{"id":"test-payment","amount":500,"paidConfirmed":true,"paidAt":"2026-10-01"}],"memo":"synthetic manual memo","salesOwner":"synthetic owner"}';
begin
  insert into public.organizations(id,slug,name) values(org,'test-inflow-'||org,'Synthetic inflow test');
  insert into public.app_current_state(organization_id,primary_revision,source_mutation_id,state_snapshot)
    values(org,'synthetic-before','synthetic-seed',jsonb_build_object('leads',jsonb_build_array(protected,
      '{"id":"crm-910003","projNo":920003,"createdAt":"2026-09-01"}'::jsonb,
      '{"id":"crm-910004","projNo":920004,"deletedAt":"2026-10-01"}'::jsonb)));
  insert into public.crm_sync_runs(id,organization_id,requested_start,requested_end,status)
    values(run,org,'2026-10-01','2026-10-07','RUNNING');
  perform private.project_v3_state(org,'synthetic-before',
    (select state_snapshot from public.app_current_state where organization_id=org));
  insert into public.crm_raw_records(organization_id,sync_run_id,record_type,external_id,source_date,source_hash,payload)
    select org,run,'LEAD',(920000+n)::text,'2026-10-01',md5(n::text),
      jsonb_build_object('client_no',910000+n,'proj_no',920000+n,'reg_dt','2026-10-01T09:00:00+09:00',
        'client_rep_name','Synthetic only','inflow_rt','["facebook"]','client_info',jsonb_build_object('annua_sales','1억~5억'))
    from generate_series(1,5) n;
  -- Another project for client 1 must not create another lead.
  insert into public.crm_raw_records(organization_id,sync_run_id,record_type,external_id,source_date,source_hash,payload)
    values(org,run,'LEAD','999999','2026-10-02','duplicate-client',
      '{"client_no":910001,"proj_no":999999,"reg_dt":"2026-10-02","inflow_rt":"google"}');
  -- Relational tombstone prevents recreation of client 5.
  insert into public.leads(organization_id,source,source_row_key,source_payload,archived_at,status_code)
    values(org,'CRM','lead:crm-910005','{"id":"crm-910005","projNo":920005}',now(),'UNKNOWN');
  result:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',true);
  if result->>'added'<>'1' or result->>'enriched'<>'1' or result->>'alreadyApplied'<>'1'
    or result->>'excludedDeleted'<>'2' then raise exception 'synthetic_plan_failed'; end if;
  if (select primary_revision from public.app_current_state where organization_id=org)<>'synthetic-before' then
    raise exception 'synthetic_dry_run_wrote'; end if;
  result:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',false);
  if result->>'verified'<>'true' then raise exception 'synthetic_commit_failed'; end if;
  select state_snapshot,primary_revision into after_state,rev from public.app_current_state where organization_id=org;
  if not exists(select 1 from jsonb_array_elements(after_state->'leads') l where l->>'id'='crm-910002'
    and (l-array['createdAt','calendarOnly','crmSheet','channel'])=(protected-array['createdAt','calendarOnly','crmSheet','channel'])) then
    raise exception 'synthetic_user_fields_changed'; end if;
  if not exists(select 1 from public.leads where organization_id=org and source_payload->>'id'='crm-910001'
    and acquired_on='2026-10-01' and channel='메타·인스타 퍼포먼스' and archived_at is null) then
    raise exception 'synthetic_projection_failed'; end if;
  result:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',false);
  if result->>'added'<>'0' or result->>'enriched'<>'0' or result->>'revision'<>rev then
    raise exception 'synthetic_idempotency_failed'; end if;
  -- Two operational IDs claiming one project must be blocked, not name-merged.
  update public.app_current_state set state_snapshot=jsonb_set(state_snapshot,'{leads}',
    (state_snapshot->'leads')||'[{"id":"collision","projNo":920001}]'::jsonb) where organization_id=org;
  result:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',true);
  if result->>'blocked'<>'1' then raise exception 'synthetic_ambiguity_not_blocked'; end if;
end $$;
rollback;
select 'synthetic_inflow_checks_passed' as result;
