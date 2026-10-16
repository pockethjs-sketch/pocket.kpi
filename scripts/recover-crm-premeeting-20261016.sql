-- Approved Oct14–16 recovery from stored CRM records; no external collection.
-- Scoped/idempotent, protected fields and finance asserted inside the transaction.
begin;
set local role service_role;
do $$
declare
  org uuid:='c9e1a7bd-f412-4fc5-a002-2226c5c586fd';
  before_state jsonb; after_state jsonb; before_finance jsonb; after_finance jsonb;
  old_deal_ids uuid[]; result jsonb; repeated jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(org::text,0));
  select state_snapshot into before_state from public.app_current_state where organization_id=org for update;
  select array_agg(id) into old_deal_ids from public.deals where organization_id=org and archived_at is null;
  select jsonb_build_object(
    'deals',(select jsonb_agg(jsonb_build_array(id,quoted_amount,contract_amount,contracted_on) order by id) from public.deals where id=any(old_deal_ids) and archived_at is null),
    'plans',(select jsonb_agg(to_jsonb(p)-array['projected_revision','row_version','updated_at'] order by id) from public.payment_plans p where organization_id=org and archived_at is null),
    'receipts',(select jsonb_agg(to_jsonb(p)-array['projected_revision'] order by id) from public.payment_receipts p where organization_id=org and archived_at is null)
  ) into before_finance;
  result:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',false);
  if result->>'verified'<>'true' or result->>'total'<>'9' then raise exception 'recovery_calendar_not_verified'; end if;
  select state_snapshot into after_state from public.app_current_state where organization_id=org;
  if before_state-array['leads','contractStatusLogs'] <> after_state-array['leads','contractStatusLogs'] then raise exception 'recovery_changed_other_documents'; end if;
  if exists(select 1 from jsonb_array_elements(before_state->'leads') b where not exists(
    select 1 from jsonb_array_elements(after_state->'leads') a where a->>'id'=b->>'id'
      and a-array['premeetingAt','bookedAt','premeetingDoneAt','crmMeetings','crmMeeting','history','status','projNo','salesOwner']
        = b-array['premeetingAt','bookedAt','premeetingDoneAt','crmMeetings','crmMeeting','history','status','projNo','salesOwner']
      and (coalesce(b->>'status','') in ('신규 DB','TM 진행중','프리미팅 확정') or a->'status' is not distinct from b->'status')
      and (coalesce(b->>'salesOwner','')='' or a->'salesOwner' is not distinct from b->'salesOwner')
      and (coalesce(b->>'projNo','')='' or a->'projNo' is not distinct from b->'projNo')
      and (coalesce(b->>'premeetingAt','')='' or a->'premeetingAt' is not distinct from b->'premeetingAt')
      and (coalesce(b->>'premeetingDoneAt','')='' or a->'premeetingDoneAt' is not distinct from b->'premeetingDoneAt')
      and (coalesce(b->>'bookedAt','')='' or a->'bookedAt' is not distinct from b->'bookedAt')
      and (coalesce(a->'history','[]') @> coalesce(b->'history','[]')))) then raise exception 'recovery_changed_protected_fields'; end if;
  select jsonb_build_object(
    'deals',(select jsonb_agg(jsonb_build_array(id,quoted_amount,contract_amount,contracted_on) order by id) from public.deals where id=any(old_deal_ids) and archived_at is null),
    'plans',(select jsonb_agg(to_jsonb(p)-array['projected_revision','row_version','updated_at'] order by id) from public.payment_plans p where organization_id=org and archived_at is null),
    'receipts',(select jsonb_agg(to_jsonb(p)-array['projected_revision'] order by id) from public.payment_receipts p where organization_id=org and archived_at is null)
  ) into after_finance;
  if before_finance is distinct from after_finance then raise exception 'recovery_changed_finance'; end if;
  repeated:=public.kpi_reconcile_crm_premeetings(org,'2026-10-14','2026-10-16',false);
  if repeated->>'added'<>'0' or repeated->>'updated'<>'0' or repeated->>'revision'<>result->>'revision' then raise exception 'recovery_repeat_not_noop'; end if;
  update public.crm_sync_runs set inflow_result=jsonb_set(inflow_result,'{calendar,companyProjection}',
    result||jsonb_build_object('mode','manual_stored_recovery','protectedFieldsUnchanged',true,'financialRelationsUnchanged',true,'repeatWasNoOp',true))
    where id=(select id from public.crm_sync_runs where organization_id=org and status='COMPLETED' order by started_at desc limit 1);
end $$;
commit;
select inflow_result->'calendar'->'companyProjection' as verification
from public.crm_sync_runs where organization_id='c9e1a7bd-f412-4fc5-a002-2226c5c586fd' and status='COMPLETED' order by started_at desc limit 1;
