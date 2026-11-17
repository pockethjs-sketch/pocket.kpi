-- Employee-authenticated API prepares one fresh source-verified contract.
-- No whole-state projector, old identity migration, archive revival or receipt rewrite.
create or replace function public.kpi_create_sheet_contract(
 p_organization_id uuid,p_base_revision text,p_source_hash text,p_fetched_at timestamptz,
 p_lead jsonb,p_event jsonb,p_log jsonb,p_request_hash text
) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='8s' set lock_timeout='2s'
as $function$
declare
 current_state public.app_current_state%rowtype; existing public.idempotency_keys%rowtype;
 old_state jsonb; next_state jsonb; item jsonb; amount numeric; paid numeric; plan_sum numeric; paid_sum numeric;
 lead_key text:=p_lead->>'id'; contract_key text:=p_lead->>'contractSheetContractKey';
 idem text:='sheet-contract-create:'||(p_lead->>'contractSheetContractKey');
 revision text:='sheet-contract-'||pg_catalog.md5(p_request_hash||clock_timestamp()::text);
 account_key uuid; lead_pk uuid; deal_key uuid; plan_key uuid; payment_key text;
 actual_date date; receipt_count integer:=0; confirmed_count integer:=0; response jsonb; stored jsonb;
begin
 if p_organization_id is null or p_lead is null or jsonb_typeof(p_lead)<>'object'
  or coalesce(contract_key,'')!~'^[a-f0-9]{64}$' or lead_key is distinct from 'contract-sheet-'||left(contract_key,40)
  or coalesce(p_source_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_request_hash,'')!~'^[a-f0-9]{64}$'
  or p_fetched_at is null or p_fetched_at<now()-interval '15 minutes' or p_fetched_at>now()+interval '2 minutes'
  or p_lead->>'contractSheetScopedCreate' is distinct from 'true' or p_lead->>'status' is distinct from '계약 완료'
  or coalesce(p_lead->>'ctype','') not in('신규','기존') or coalesce(p_lead->>'contractSheetCreationMode','') not in('standalone','linked')
  or coalesce(p_lead->>'archivedAt','')<>'' or coalesce(p_lead->>'archived_at','')<>''
  or coalesce(p_lead->>'createdAt','')<>'' or coalesce(p_lead->>'premeetingAt','')<>''
  or coalesce(p_lead->>'premeetingDoneAt','')<>'' or coalesce(p_lead->>'bookedAt','')<>''
  or jsonb_typeof(p_lead->'payments') is distinct from 'array' or jsonb_array_length(p_lead->'payments') not between 1 and 2
  or coalesce(p_event->>'leadId','')<>lead_key or coalesce(p_log->>'leadId','')<>lead_key then
  return jsonb_build_object('ok',false,'error','contract_source_held');
 end if;
 amount:=(p_lead->>'contractAmount')::numeric;paid:=(p_lead->>'paid')::numeric;
 if amount is null or paid is null or amount<=0 or paid<0 or paid>amount or amount<>trunc(amount) or paid<>trunc(paid)
  or amount>9007199254740991 or private.kpi_try_date(p_lead->>'contractAt') is null then
  return jsonb_build_object('ok',false,'error','contract_source_held'); end if;
 select sum((p->>'amount')::numeric),coalesce(sum((p->>'amount')::numeric) filter(where p->>'paidConfirmed'='true'),0),
  count(*) filter(where p->>'paidConfirmed'='true') into plan_sum,paid_sum,confirmed_count from jsonb_array_elements(p_lead->'payments')p;
 if plan_sum<>amount or paid_sum<>paid or confirmed_count<>(case when paid>0 then 1 else 0 end)
  or exists(select 1 from jsonb_array_elements(p_lead->'payments')p where (p->>'amount')::numeric<=0
    or ((p->>'paidConfirmed') is distinct from 'true' and coalesce(p->>'paidAt','')<>'')
    or (coalesce(p->>'paidAt','')<>'' and private.kpi_try_date(p->>'paidAt') is null)) then
  return jsonb_build_object('ok',false,'error','contract_source_held');end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0)) then
  return jsonb_build_object('ok',false,'error','contract_create_busy');end if;
 select * into current_state from public.app_current_state where organization_id=p_organization_id for update;
 if not found then return jsonb_build_object('ok',false,'error','contract_state_unavailable');end if;
 select * into existing from public.idempotency_keys where organization_id=p_organization_id and key=idem;
 if found then
  if existing.request_hash<>p_request_hash then return jsonb_build_object('ok',false,'error','contract_already_exists');end if;
  select x into stored from jsonb_array_elements(current_state.state_snapshot->'leads')x where x->>'id'=lead_key;
  if stored is null or coalesce(stored->>'archivedAt','')<>'' or coalesce(stored->>'archived_at','')<>''
    or (stored->>'contractAmount')::numeric<>amount or (stored->>'paid')::numeric<>paid
    or stored->'payments' is distinct from p_lead->'payments' then return jsonb_build_object('ok',false,'error','contract_already_exists');end if;
  if not exists(select 1 from public.leads l join public.deals d on d.lead_id=l.id and d.archived_at is null
    where l.organization_id=p_organization_id and l.archived_at is null and l.source_payload=stored and d.contract_amount=amount
    and (select sum(planned_amount) from public.payment_plans where deal_id=d.id and archived_at is null)=amount
    and (select coalesce(sum(received_amount),0) from public.payment_receipts where deal_id=d.id and archived_at is null)=paid) then
    return jsonb_build_object('ok',false,'error','contract_created_verification_failed');end if;
  return existing.response||jsonb_build_object('duplicate',true,'revision',current_state.primary_revision);
 end if;
 if current_state.primary_revision is distinct from p_base_revision then return jsonb_build_object('ok',false,'error','revision_conflict');end if;
 if exists(select 1 from public.leads where organization_id=p_organization_id and
   (source_payload->>'id'=lead_key or source_payload->>'contractSheetContractKey'=contract_key or source_row_key='lead:'||lead_key))
  or exists(select 1 from jsonb_array_elements(current_state.state_snapshot->'leads')x where x->>'id'=lead_key or x->>'contractSheetContractKey'=contract_key)
  or exists(select 1 from public.accounts where organization_id=p_organization_id and source_row_key='account:'||lead_key) then
  return jsonb_build_object('ok',false,'error','contract_already_exists');end if;
 if exists(select 1 from public.leads where organization_id=p_organization_id and archived_at is not null
   and source_payload->>'contractAt'=p_lead->>'contractAt'
   and regexp_replace(lower(source_payload->>'company'),'[^a-z0-9가-힣]','','g')=regexp_replace(lower(p_lead->>'company'),'[^a-z0-9가-힣]','','g')) then
  return jsonb_build_object('ok',false,'error','contract_source_held');end if;
 if p_lead->>'contractSheetCreationMode'='linked' and (select count(*) from public.leads where organization_id=p_organization_id
   and archived_at is null and source_payload->>'id'=p_lead->>'contractCompanyLeadId')<>1 then
  return jsonb_build_object('ok',false,'error','contract_candidate_changed');end if;
 old_state:=current_state.state_snapshot;
 insert into public.accounts(organization_id,name,normalized_name,source,source_row_key,source_payload,field_owners,state,projected_revision)
 values(p_organization_id,p_lead->>'company',lower(p_lead->>'company'),'GOOGLE_SHEETS','account:'||lead_key,
  jsonb_build_object('projection','scoped-sheet-contract','leadKey',lead_key),'{}','ACTIVE',revision) returning id into account_key;
 insert into public.leads(organization_id,account_id,source,source_row_key,status_code,channel,source_payload,field_owners,state,projected_revision)
 values(p_organization_id,account_key,'GOOGLE_SHEETS','lead:'||lead_key,'계약 완료','계약 프로세스 시트',p_lead,'{}','ACTIVE',revision) returning id into lead_pk;
 insert into public.deals(organization_id,account_id,lead_id,source,source_row_key,service_code,stage_code,quoted_amount,contract_amount,contracted_on,source_payload,field_owners,state,projected_revision)
 values(p_organization_id,account_key,lead_pk,'GOOGLE_SHEETS','deal:'||lead_key,nullif(p_lead->>'buildup',''),'계약 완료',amount,amount,
  private.kpi_try_date(p_lead->>'contractAt'),p_lead,'{}','ACTIVE',revision) returning id into deal_key;
 for item in select value from jsonb_array_elements(p_lead->'payments') loop
  payment_key:='payment:'||lead_key||':'||(item->>'id');
  insert into public.payment_plans(organization_id,deal_id,installment_code,planned_amount,due_on,status,source,source_row_key,field_owners,projected_revision)
  values(p_organization_id,deal_key,item->>'label',(item->>'amount')::numeric,null,
   case when item->>'paidConfirmed'='true' then 'PAID'::public.kpi_payment_status else 'PLANNED'::public.kpi_payment_status end,
   'GOOGLE_SHEETS',payment_key,'{}',revision) returning id into plan_key;
  if item->>'paidConfirmed'='true' then
   actual_date:=private.kpi_try_date(item->>'paidAt');
   insert into public.payment_receipts(organization_id,payment_plan_id,deal_id,received_amount,received_on,source,source_row_key,projected_revision)
   values(p_organization_id,plan_key,deal_key,(item->>'amount')::numeric,actual_date,'GOOGLE_SHEETS','receipt:'||payment_key,revision);
   receipt_count:=receipt_count+1;
  end if;
 end loop;
 next_state:=old_state||jsonb_build_object('leads',coalesce(old_state->'leads','[]')||jsonb_build_array(p_lead),
  'contractEvents',coalesce(old_state->'contractEvents','[]')||jsonb_build_array(p_event),
  'contractStatusLogs',coalesce(old_state->'contractStatusLogs','[]')||jsonb_build_array(p_log));
 update public.app_current_state set primary_revision=revision,state_snapshot=next_state,source_mutation_id=idem,updated_at=now() where organization_id=p_organization_id;
 insert into public.app_state_daily_checkpoints(organization_id,checkpoint_date,primary_revision,state_snapshot,source_mutation_id)
 values(p_organization_id,(now() at time zone 'Asia/Seoul')::date,revision,next_state,idem) on conflict(organization_id,checkpoint_date)do nothing;
 -- Revision metadata only: old payloads, amounts, dates, flags and archive states remain untouched.
 update public.leads set projected_revision=revision where organization_id=p_organization_id and archived_at is null and projected_revision is distinct from revision;
 update public.app_documents set projected_revision=revision where organization_id=p_organization_id and projected_revision is distinct from revision;
 insert into public.app_documents(organization_id,document_key,document_value,projected_revision,updated_at)
 values(p_organization_id,'contractEvents',next_state->'contractEvents',revision,now()),
  (p_organization_id,'contractStatusLogs',next_state->'contractStatusLogs',revision,now())
 on conflict(organization_id,document_key)do update set document_value=excluded.document_value,projected_revision=excluded.projected_revision,updated_at=excluded.updated_at;
 insert into public.deal_activity(organization_id,deal_id,action_code,path,detail,metadata,source,occurred_at,source_row_key)
 values(p_organization_id,deal_key,'외부 시트 생성','계약 프로세스 시트','개별 승인 계약 생성',p_log->'meta','GOOGLE_SHEETS',now(),'contract-status:'||(p_log->>'id'));
 insert into public.app_state_projections(organization_id,primary_revision,status,entity_counts,financial_totals,projected_at)
 select p_organization_id,revision,'CURRENT',jsonb_build_object(
  'accounts',(select count(*) from public.accounts where organization_id=p_organization_id and archived_at is null),
  'leads',(select count(*) from public.leads where organization_id=p_organization_id and archived_at is null),
  'deals',(select count(*) from public.deals where organization_id=p_organization_id and archived_at is null),
  'paymentPlans',(select count(*) from public.payment_plans where organization_id=p_organization_id and archived_at is null),
  'paymentReceipts',(select count(*) from public.payment_receipts where organization_id=p_organization_id and archived_at is null)),
  jsonb_build_object('contractAmount',coalesce(sum(contract_amount),0),
  'receivedAmount',(select coalesce(sum(received_amount),0) from public.payment_receipts where organization_id=p_organization_id and archived_at is null),
  'marketingSpend',(select coalesce(sum(spend_amount),0) from public.marketing_daily_spend where organization_id=p_organization_id and archived_at is null)),now()
 from public.deals where organization_id=p_organization_id and archived_at is null
 on conflict(organization_id)do update set primary_revision=excluded.primary_revision,status=excluded.status,entity_counts=excluded.entity_counts,
  financial_totals=excluded.financial_totals,projected_at=excluded.projected_at,error_detail=null;
 if not exists(select 1 from public.deals d where d.id=deal_key and d.source_payload=p_lead and d.contract_amount=amount
  and (select sum(planned_amount) from public.payment_plans where deal_id=d.id and archived_at is null)=amount
  and (select coalesce(sum(received_amount),0) from public.payment_receipts where deal_id=d.id and archived_at is null)=paid)
  or (select count(*) from public.payment_receipts where deal_id=deal_key and archived_at is null)<>confirmed_count
  or (select count(*) from public.payment_plans where deal_id=deal_key and archived_at is null and status='PAID')<>confirmed_count
  or exists(select 1 from public.payment_receipts where deal_id=deal_key and received_on is distinct from actual_date)
  or not exists(select 1 from public.app_current_state s cross join jsonb_array_elements(s.state_snapshot->'leads')x
   where s.organization_id=p_organization_id and x=p_lead) then raise exception 'CONTRACT_CREATED_VERIFICATION_FAILED';end if;
 response:=jsonb_build_object('ok',true,'verified',true,'revision',revision,'baseRevision',p_base_revision,'leadId',lead_key,
  'contractKey',contract_key,'contractAmount',amount,'confirmedPaid',paid,'confirmedCount',confirmed_count,
  'paymentCount',jsonb_array_length(p_lead->'payments'),'committedAt',now(),'duplicate',false);
 insert into public.idempotency_keys(organization_id,key,operation,request_hash,status,response)
 values(p_organization_id,idem,'SUPABASE_SHEET_CONTRACT_CREATE',p_request_hash,'COMMIT',response);
 insert into public.audit_events(organization_id,entity_type,action_code,source,idempotency_key,metadata)
 values(p_organization_id,'sheet_contract','COMMITTED','SYSTEM',idem,jsonb_build_object('sourceHash',p_source_hash,'sourceFetchedAt',p_fetched_at,'contractKey',contract_key,'contractAmount',amount,'confirmedPaid',paid));
 insert into public.shadow_mutation_queue(organization_id,mutation_id,primary_revision,mutation,state_snapshot,field_ownership_claims,status,attempts,committed_at)
 values(p_organization_id,idem,revision,jsonb_build_object('schemaVersion',3,'origin','user','reason','sheet_contract_create_approved',
  'collections',jsonb_build_object('leads',jsonb_build_object('idField','id','upsert',jsonb_build_array(p_lead)),
  'contractEvents',jsonb_build_object('idField','id','upsert',jsonb_build_array(p_event)),
  'contractStatusLogs',jsonb_build_object('idField','id','upsert',jsonb_build_array(p_log))),'changedCount',3),null,'[]','COMMITTED',1,now());
 return response;
end;
$function$;
revoke all on function public.kpi_create_sheet_contract(uuid,text,text,timestamptz,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.kpi_create_sheet_contract(uuid,text,text,timestamptz,jsonb,jsonb,jsonb,text) to service_role;

-- A stale pre-release creation may remain in a browser journal. Reject its upsert
-- rather than allowing a later generic retry to replace the acknowledged contract.
do $guard$
declare body text; marker text:=$marker$
  if exists(select 1 from jsonb_array_elements(coalesce(p_mutation#>'{collections,leads,upsert}','[]'::jsonb)) incoming
    join jsonb_array_elements(v_current.state_snapshot->'leads') saved on saved->>'id'=incoming->>'id'
    where saved->>'contractSheetScopedCreate'='true' and incoming->>'contractSheetScopedCreate' is distinct from 'true') then
    return jsonb_build_object('ok',false,'error','contract_scoped_recreate_blocked');
  end if;
$marker$;
begin
 select pg_get_functiondef('public.commit_primary_mutation(uuid,text,text,text,text,jsonb)'::regprocedure) into body;
 if position('contract_scoped_recreate_blocked' in body)=0 then
  if position('  if p_mutation->>''origin''=''crm''' in body)=0 then raise exception 'SCOPED_CREATE_COMMIT_SIGNATURE_CHANGED';end if;
  -- Insert once, before mutation application, without changing function security or ACL.
  body:=overlay(body placing marker from position('  if p_mutation->>''origin''=''crm''' in body) for 0);
  execute body;
 end if;
end;
$guard$;
