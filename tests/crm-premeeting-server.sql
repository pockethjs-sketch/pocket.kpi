-- Synthetic integration test, rollback required. No real customer fixtures.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); run uuid:=gen_random_uuid(); result jsonb; repeated jsonb;
  original jsonb:='{"id":"crm-901","projNo":902,"company":"Synthetic","status":"계약 완료","contractAt":"2026-10-01","contractAmount":500,"paid":300,"payments":[{"id":"synthetic-pay","amount":300,"paidConfirmed":true}],"memo":"Synthetic manual memo","salesOwner":"Synthetic owner","history":[]}';
  before_state jsonb; after_state jsonb; before_plan jsonb; before_receipt jsonb;
begin
  insert into public.organizations(id,slug,name) values(org,'synthetic-calendar-'||org,'Synthetic only');
  insert into public.app_current_state(organization_id,primary_revision,source_mutation_id,state_snapshot)
    values(org,'synthetic-before','synthetic-seed',jsonb_build_object('leads',jsonb_build_array(original)));
  perform private.project_v3_state(org,'synthetic-before',jsonb_build_object('leads',jsonb_build_array(original)));
  select jsonb_agg(to_jsonb(p)-array['projected_revision','row_version','updated_at']) into before_plan from public.payment_plans p where organization_id=org;
  select jsonb_agg(to_jsonb(p)-array['projected_revision']) into before_receipt from public.payment_receipts p where organization_id=org;
  insert into public.crm_sync_runs(id,organization_id,requested_start,requested_end,status) values(run,org,'2026-10-14','2026-10-16','RUNNING');
  insert into public.crm_raw_records(organization_id,sync_run_id,record_type,external_id,source_date,source_hash,payload,last_seen_at)
  values
    (org,run,'MEETING','101','2026-10-14','old','{"ms_no":101,"client_no":901,"proj_no":902,"mr_type":1,"mr_checked":0,"start_dt":"2026-10-14T10:00:00+09:00"}',now()-interval '1 hour'),
    (org,run,'MEETING','101','2026-10-15','new','{"ms_no":101,"client_no":901,"proj_no":902,"mr_type":1,"mr_checked":1,"start_dt":"2026-10-15T10:00:00+09:00"}',now()),
    (org,run,'MEETING','102','2026-10-15','repeat-client','{"ms_no":102,"client_no":901,"proj_no":902,"mr_type":1,"mr_checked":0,"start_dt":"2026-10-15T11:00:00+09:00"}',now()),
    (org,run,'MEETING','103','2026-10-16','unlinked','{"ms_no":103,"mr_type":1,"mr_checked":0,"mr_name":"Synthetic new","start_dt":"2026-10-15T15:00:00Z"}',now()),
    (org,run,'MEETING','104','2026-10-15','not-pre','{"ms_no":104,"mr_type":2,"start_dt":"2026-10-15T10:00:00+09:00"}',now());
  result:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',true);
  if result->>'total'<>'3' or result->>'added'<>'1' or result->>'updated'<>'1' or result->>'missing'<>'3' then raise exception 'synthetic_premeeting_plan_failed'; end if;
  if (select primary_revision from public.app_current_state where organization_id=org)<>'synthetic-before' then raise exception 'synthetic_dry_run_wrote'; end if;
  result:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',false);
  if result->>'verified'<>'true' or result->>'stored'<>'3' or result->'storedDaily'<> '{"2026-10-15":2,"2026-10-16":1}' then raise exception 'synthetic_premeeting_commit_failed'; end if;
  select l into after_state from public.app_current_state s cross join lateral jsonb_array_elements(s.state_snapshot->'leads') l where organization_id=org and l->>'id'='crm-901';
  if after_state-array['premeetingAt','bookedAt','premeetingDoneAt','crmMeetings','crmMeeting','history'] <> original-array['premeetingAt','bookedAt','premeetingDoneAt','crmMeetings','crmMeeting','history'] then raise exception 'synthetic_user_fields_changed'; end if;
  if before_plan is distinct from (select jsonb_agg(to_jsonb(p)-array['projected_revision','row_version','updated_at']) from public.payment_plans p where organization_id=org)
    or before_receipt is distinct from (select jsonb_agg(to_jsonb(p)-array['projected_revision']) from public.payment_receipts p where organization_id=org) then raise exception 'synthetic_finance_changed'; end if;
  repeated:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',false);
  if repeated->>'added'<>'0' or repeated->>'updated'<>'0' or repeated->>'revision'<>result->>'revision' then raise exception 'synthetic_premeeting_repeat_wrote'; end if;
  -- Conflicting identities must block the entire plan, not select the first candidate.
  update public.app_current_state set state_snapshot=jsonb_set(state_snapshot,'{leads}',(state_snapshot->'leads')||'[{"id":"collision","projNo":902,"status":"신규 DB"}]') where organization_id=org;
  repeated:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',false);
  if repeated->>'ok'<>'false' or repeated->>'blocked'<>'2' then raise exception 'synthetic_premeeting_collision_not_blocked'; end if;
end $$;
rollback;
select 'synthetic_premeeting_checks_passed' as result;
