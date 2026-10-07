-- Approved, scoped recovery. No customer rows leave Postgres. All invariants roll back on failure.
begin;
set local role service_role;
do $$
declare
  org uuid := 'c9e1a7bd-f412-4fc5-a002-2226c5c586fd';
  before_leads jsonb;
  after_leads jsonb;
  finance_before jsonb;
  finance_after jsonb;
  result jsonb;
  repeated jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(org::text,0));
  select state_snapshot->'leads' into before_leads from public.app_current_state where organization_id=org for update;
  select jsonb_build_object(
    'deals',(select jsonb_agg(jsonb_build_array(source_row_key,stage_code,quoted_amount,contract_amount,contracted_on) order by source_row_key) from public.deals where organization_id=org and archived_at is null),
    'plans',(select jsonb_agg(jsonb_build_array(source_row_key,planned_amount,due_on,status) order by source_row_key) from public.payment_plans where organization_id=org and archived_at is null),
    'receipts',(select jsonb_agg(jsonb_build_array(source_row_key,received_amount,received_on) order by source_row_key) from public.payment_receipts where organization_id=org and archived_at is null)
  ) into finance_before;
  result:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',false);
  if result->>'ok'<>'true' then raise exception 'recovery_blocked'; end if;
  select state_snapshot->'leads' into after_leads from public.app_current_state where organization_id=org;
  if exists(select 1 from jsonb_array_elements(before_leads) b where not exists(
    select 1 from jsonb_array_elements(after_leads) a where a->>'id'=b->>'id'
      and (a-array['createdAt','calendarOnly','crmSheet','channel'])=(b-array['createdAt','calendarOnly','crmSheet','channel']))) then
    raise exception 'recovery_changed_protected_fields';
  end if;
  select jsonb_build_object(
    'deals',(select jsonb_agg(jsonb_build_array(source_row_key,stage_code,quoted_amount,contract_amount,contracted_on) order by source_row_key) from public.deals where organization_id=org and archived_at is null),
    'plans',(select jsonb_agg(jsonb_build_array(source_row_key,planned_amount,due_on,status) order by source_row_key) from public.payment_plans where organization_id=org and archived_at is null),
    'receipts',(select jsonb_agg(jsonb_build_array(source_row_key,received_amount,received_on) order by source_row_key) from public.payment_receipts where organization_id=org and archived_at is null)
  ) into finance_after;
  if finance_before is distinct from finance_after then raise exception 'recovery_changed_financial_relations'; end if;
  repeated:=public.kpi_reconcile_crm_inflow(org,'2026-09-30','2026-10-07',false);
  if repeated->>'ok'<>'true' or repeated->>'added'<>'0' or repeated->>'enriched'<>'0'
    or repeated->>'revision'<>result->>'revision' then raise exception 'recovery_not_idempotent'; end if;
  -- Annotate the latest collection, without changing its original status/count/timestamps.
  update public.crm_sync_runs set inflow_completed_at=now(),
    inflow_result=result||jsonb_build_object('mode','manual_backfill','protectedFieldsUnchanged',true,
      'financialRelationsUnchanged',true,'repeatWasNoOp',true)
    where id=(select id from public.crm_sync_runs where organization_id=org and status='COMPLETED'
      order by started_at desc limit 1);
end $$;
commit;
select inflow_completed_at,inflow_result from public.crm_sync_runs
where organization_id='c9e1a7bd-f412-4fc5-a002-2226c5c586fd' and inflow_completed_at is not null
order by inflow_completed_at desc limit 1;
