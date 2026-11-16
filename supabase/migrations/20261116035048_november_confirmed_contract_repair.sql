-- One explicitly approved batch. No global projector, archive revival, or browser grant.
create or replace function public.kpi_repair_november_confirmed_contracts(
  p_organization_id uuid,p_base_revision text,p_source_hash text,p_fetched_at timestamptz,p_rows jsonb,p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='45s' set lock_timeout='5s' as $repair$
declare
  approved jsonb:='[{"keyHash":"11a8ecbcec9cdb3bcb9a8c7dc134b662","date":"2026-11-06","amount":4466000,"percent":100,"parentIdHash":"87fbe6c68d086a661fc89ce3225ddf85","parentBeforeHash":"fab99b62bbb4126b88de8c31a0462ecc","mode":"reuse-empty"},{"keyHash":"16aa10db379b98b5e4cc5590a3c8b630","date":"2026-11-06","amount":2750000,"percent":100,"parentIdHash":"3e80979bc61a8a2fad101e4dbcd6c8bc","parentBeforeHash":"e6e1906691270564b3afcaa4be599c91","mode":"new-contract"},{"keyHash":"1865ff7c695ed0e1ac4089d440478c37","date":"2026-11-03","amount":4180000,"percent":100,"parentIdHash":"2bc5f87efcca98bc644a1a6a50a8d484","parentBeforeHash":"a1657e3a0320b5a81bc19de5ae5ff6f0","mode":"new-contract"},{"keyHash":"5caf3a768ff6d672fddfb27442829ab1","date":"2026-11-11","amount":3080000,"percent":100,"parentIdHash":"2512b098fd0c872ac5a062d8d495fd8b","parentBeforeHash":"0867f3cc00cd2bc51b3bb4ae723b7017","mode":"reuse-empty"},{"keyHash":"789744d25f4cd89dfeacf8fd1b87593c","date":"2026-11-03","amount":6050000,"percent":100,"parentIdHash":"b9d9e81a698baf774202a61b486c914e","parentBeforeHash":"e1ec83262f5c5f7adddae559833ee97c","mode":"reuse-empty"},{"keyHash":"7d858a673edb28e0775afe64eaa845f1","date":"2026-11-03","amount":2750000,"percent":50,"parentIdHash":"4afd81e8734df159e44b57194779439e","parentBeforeHash":"52324f4c929aeed0fa13f9174110d6ef","mode":"reuse-empty"},{"keyHash":"8c9b22a12038990aff0bbb90e30c7191","date":"2026-11-10","amount":4147000,"percent":100,"parentIdHash":"918c8463fb802193b9bfce59f82d8279","parentBeforeHash":"123f596a3c809542ecad92323e328028","mode":"reuse-empty"},{"keyHash":"8d1a1adc929b5bf2a49e1ec8256cbd60","date":"2026-11-02","amount":5500000,"percent":100,"parentIdHash":"aef26d62ee5d4f3abba502ff08cb25fd","parentBeforeHash":"91350a7fcf62c2f772776b77d9fb3f59","mode":"reuse-empty"},{"keyHash":"a1ee7eb98cdf85d460b6ef3ccaeb8ee3","date":"2026-11-04","amount":3740000,"percent":100,"parentIdHash":"888d71d618c77a7dd5fc9d8f3a2610f0","parentBeforeHash":"5b79f84a0a853d7a990c4c5c401aa79c","mode":"new-contract"},{"keyHash":"b3bb2e4e3937a04a1af01b5601d8e46e","date":"2026-11-02","amount":7480000,"percent":100,"parentIdHash":"28cb2c87e37e3ea7dca9d4e8068a9e32","parentBeforeHash":"6ee6d564f161b70bb71872a98f79233b","mode":"new-contract"},{"keyHash":"bebe2e5a33dc393c3cb5f3fff7b566a3","date":"2026-11-12","amount":275000,"percent":100,"parentIdHash":"1b5526138237fa888acfafe8888aecb9","parentBeforeHash":"db5cc3212c0a02cb75599745048c346c","mode":"new-contract"},{"keyHash":"c052f15a66c634c3137a0a35e97780ba","date":"2026-11-02","amount":1815000,"percent":50,"parentIdHash":null,"parentBeforeHash":null,"mode":"new-contract"},{"keyHash":"f4b5be61353647779ed97994f874bb61","date":"2026-11-05","amount":4180000,"percent":100,"parentIdHash":"4b6d59ea2a0dc70d93211c4da1fe684b","parentBeforeHash":"44f9dab6d259925b792b9c867eafb62f","mode":"reuse-empty"},{"keyHash":"fdc15678c82ed9706ec7ae00fa009306","date":"2026-11-02","amount":1650000,"percent":100,"parentIdHash":"7f197aac256c77eb5ad0d6c812bbe14a","parentBeforeHash":"1da15b29e1b7a1351321321e2df27b19","mode":"reuse-empty"}]'::jsonb;
  current_state public.app_current_state%rowtype; parent public.leads%rowtype; rel public.leads%rowtype;
  old_state jsonb; next_state jsonb; working jsonb; old_lead jsonb; new_lead jsonb; item jsonb; payment jsonb;
  before_accounts jsonb; before_leads jsonb; before_deals jsonb; before_plans jsonb; before_receipts jsonb; before_events jsonb; before_docs jsonb;
  logs jsonb:='[]'; patches jsonb:='[]'; upserts jsonb:='[]'; results jsonb:='[]'; mutation jsonb; log jsonb;
  revision text; lead_key text; parent_key text; payment_key text; deal_key uuid; plan_key uuid; account_key uuid;
  amount numeric; paid numeric; n integer; new_leads integer:=0; updated_leads integer:=0; new_deals integer:=0;
  changed_ids uuid[]:='{}'; changed_deals uuid[]:='{}'; paid_at date; result jsonb;
begin
  if p_organization_id is null or nullif(p_base_revision,'') is null or p_source_hash!~'^[0-9a-f]{64}$'
    or p_fetched_at is null or p_fetched_at<clock_timestamp()-interval '15 minutes' or p_fetched_at>clock_timestamp()+interval '1 minute'
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>14 or p_dry_run is null then raise exception 'NOVEMBER_REPAIR_INVALID'; end if;
  revision:='sheet-november-confirmed-'||md5((select string_agg((x-array['row','parentBeforeHash'])::text,',' order by x->>'keyHash') from jsonb_array_elements(p_rows)x));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,0));
  if exists(select 1 from public.idempotency_keys where organization_id=p_organization_id and key=revision and status='COMMIT') then
    select response into result from public.idempotency_keys where organization_id=p_organization_id and key=revision;
    return result||jsonb_build_object('duplicate',true,'changed',0);
  end if;
  select * into strict current_state from public.app_current_state where organization_id=p_organization_id for update;
  if current_state.primary_revision<>p_base_revision then raise exception 'NOVEMBER_REPAIR_REVISION_CONFLICT'; end if;
  lock table public.accounts,public.leads,public.deals,public.payment_plans,public.payment_receipts,public.contract_events,public.app_documents in share row exclusive mode;
  old_state:=current_state.state_snapshot; working:=old_state->'leads';
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_accounts from public.accounts x where organization_id=p_organization_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_leads from public.leads x where organization_id=p_organization_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_deals from public.deals x where organization_id=p_organization_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_plans from public.payment_plans x where organization_id=p_organization_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_receipts from public.payment_receipts x where organization_id=p_organization_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into before_events from public.contract_events x where organization_id=p_organization_id;
  select coalesce(jsonb_object_agg(document_key,document_value),'{}') into before_docs from public.app_documents where organization_id=p_organization_id;
  -- The nested block is an actual rollback rehearsal, not a planner-only dry run.
  begin
    for item in select value from jsonb_array_elements(p_rows) loop
      if not exists(select 1 from jsonb_array_elements(approved)a where a->>'keyHash'=item->>'keyHash' and a->>'date'=item->>'contractDate'
        and a->'amount'=item->'amount' and a->'percent'=item->'percent' and a->'mode'=item->'mode'
        and a->'parentIdHash' is not distinct from item->'parentIdHash' and a->'parentBeforeHash' is not distinct from item->'parentBeforeHash')
        or (select count(*) from jsonb_array_elements(p_rows)x where x->>'keyHash'=item->>'keyHash')<>1 then raise exception 'NOVEMBER_REPAIR_NOT_APPROVED'; end if;
      if item->>'contractKey'!~'^[0-9a-f]{64}$' or item->>'keyHash'!~'^[0-9a-f]{32}$'
        or item->>'contractDate'!~'^2026-11-[0-9]{2}$' or (item->>'contractDate')::date>(now() at time zone 'Asia/Seoul')::date
        or coalesce(item->>'company','')='' or (item->>'amount')::numeric<=0 or (item->>'percent')::numeric not in(50,100)
        or (item->>'paid')::numeric<>round((item->>'amount')::numeric*(item->>'percent')::numeric/100)
        or item->>'mode' not in('reuse-empty','new-contract') then raise exception 'NOVEMBER_REPAIR_TARGET_INVALID'; end if;
      if exists(select 1 from jsonb_array_elements(working)x where x->>'contractSheetContractKey'=item->>'contractKey'
        or x->>'id'='contract-sheet-'||left(item->>'contractKey',40)) then raise exception 'NOVEMBER_REPAIR_DUPLICATE_CONTRACT'; end if;
      parent_key:=null; parent:=null;
      if nullif(item->>'parentIdHash','') is not null then
        select * into strict parent from public.leads where organization_id=p_organization_id and archived_at is null and md5(source_payload->>'id')=item->>'parentIdHash';
        if md5(parent.source_payload::text)<>item->>'parentBeforeHash' then raise exception 'NOVEMBER_REPAIR_PARENT_CHANGED'; end if;
        parent_key:=parent.source_payload->>'id';
      end if;
      amount:=(item->>'amount')::numeric; paid:=(item->>'paid')::numeric; paid_at:=nullif(item->>'paidAt','')::date;
      if paid_at is not null and (paid_at>'2026-11-16'::date or paid_at<'2026-01-01'::date) then raise exception 'NOVEMBER_REPAIR_RECEIPT_DATE_INVALID'; end if;
      old_lead:=null; deal_key:=null;
      if item->>'mode'='reuse-empty' then
        if parent.id is null then raise exception 'NOVEMBER_REPAIR_PARENT_REQUIRED'; end if;
        old_lead:=parent.source_payload; lead_key:=old_lead->>'id'; rel:=parent;
        if coalesce(old_lead->>'contractAt','')<>'' or coalesce((old_lead->>'contractAmount')::numeric,0)<>0
          or coalesce((old_lead->>'paid')::numeric,0)<>0 or coalesce(old_lead->'payments','[]')<>'[]'
          or coalesce(old_lead->>'archivedAt',old_lead->>'archived_at',old_lead->>'deletedAt','')<>'' then raise exception 'NOVEMBER_REPAIR_NOT_EMPTY'; end if;
        select count(*) into n from public.deals where organization_id=p_organization_id and lead_id=parent.id;
        if n>1 or exists(select 1 from public.deals where organization_id=p_organization_id and lead_id=parent.id and
          (archived_at is not null or contracted_on is not null or coalesce(contract_amount,0)<>0)) then raise exception 'NOVEMBER_REPAIR_EXISTING_DEAL_CONFLICT'; end if;
        select id into deal_key from public.deals where organization_id=p_organization_id and lead_id=parent.id and archived_at is null;
        if exists(select 1 from public.payment_plans where deal_id=deal_key) or exists(select 1 from public.payment_receipts where deal_id=deal_key) then raise exception 'NOVEMBER_REPAIR_EXISTING_PAYMENT_CONFLICT'; end if;
        new_lead:=old_lead; updated_leads:=updated_leads+1;
      else
        lead_key:='contract-sheet-'||left(item->>'contractKey',40);
        if exists(select 1 from public.leads where organization_id=p_organization_id and source_row_key='lead:'||lead_key)
          or exists(select 1 from public.accounts where organization_id=p_organization_id and source_row_key='account:'||lead_key) then raise exception 'NOVEMBER_REPAIR_ARCHIVED_OR_DUPLICATE_ID'; end if;
        new_lead:=jsonb_build_object('id',lead_key,'company',item->>'company','contact','','phone','','email','','createdAt','',
          'channel','계약 프로세스 시트','status','계약 완료','ctype',item->>'ctype','tmOwner','','salesOwner',coalesce(parent.source_payload->>'salesOwner',''),
          'expected',0,'paid',0,'contractAmount',0,'payments','[]'::jsonb,'buildup',item->>'service','buildups',jsonb_build_array(item->>'service'),
          'lineItems','[]'::jsonb,'memo','','history','[]'::jsonb,'sent','{}'::jsonb,'pushLog','[]'::jsonb,'newsletter',false,
          'premeetingAt','','premeetingDoneAt','','bookedAt','','contractSheetImported',true,'contractCompanyLeadId',coalesce(parent_key,''),
          'contractSheetCreationMode',case when parent_key is null then 'new' else 'linked' end,'contractSheetSourceCustomerType',item->>'ctype');
        new_leads:=new_leads+1;
      end if;
      payment:=jsonb_build_object('id','sheet-confirmed-'||left(item->>'contractKey',32),'no',1,'label',case when paid=amount then '일시금' else '확인 입금' end,
        'amount',paid,'paidConfirmed',true,'paidAt',coalesce(paid_at::text,''),'actualPaidAtUnknown',paid_at is null,'dueAt','','method','','memo','');
      new_lead:=new_lead||jsonb_build_object('status','계약 완료','contractAt',item->>'contractDate','contractAmount',amount,'paid',paid,'payments',jsonb_build_array(payment),
        'contractSheetContractKey',item->>'contractKey','contractSheetPaymentRepair',jsonb_build_object('sourceHash',p_source_hash,'sourceRow',item->'row','keyHash',item->>'keyHash',
        'sourceCheckedAt',p_fetched_at,'appliedAt',now(),'contractDate',item->>'contractDate','actualPaidAt',coalesce(paid_at::text,''),'percent',item->'percent','scope','NOVEMBER_USER_AUTHORIZED'));
      if paid<amount then new_lead:=jsonb_set(new_lead,'{payments}',new_lead->'payments'||jsonb_build_array(jsonb_build_object(
        'id','sheet-remaining-'||left(item->>'contractKey',32),'no',2,'label','미수 잔액','amount',amount-paid,'paidConfirmed',false,'paidAt','','dueAt','','method','','memo',''))); end if;
      if old_lead is not null and old_lead-array['status','contractAt','contractAmount','paid','payments','contractSheetContractKey','contractSheetPaymentRepair']
        is distinct from new_lead-array['status','contractAt','contractAmount','paid','payments','contractSheetContractKey','contractSheetPaymentRepair'] then raise exception 'NOVEMBER_REPAIR_PROTECTED_FIELD'; end if;
      if item->>'mode'='new-contract' then
        insert into public.accounts(organization_id,name,normalized_name,source,source_row_key,source_payload,field_owners,state,projected_revision)
        values(p_organization_id,new_lead->>'company',lower(new_lead->>'company'),'GOOGLE_SHEETS','account:'||lead_key,
          jsonb_build_object('projection','v3-state','leadKey',lead_key),'{}','ACTIVE',revision) returning id into account_key;
        insert into public.leads(organization_id,account_id,source,source_row_key,status_code,channel,source_payload,field_owners,state,projected_revision)
        values(p_organization_id,account_key,'GOOGLE_SHEETS','lead:'||lead_key,'계약 완료','계약 프로세스 시트',new_lead,'{}','ACTIVE',revision) returning * into rel;
        working:=working||jsonb_build_array(new_lead); upserts:=upserts||jsonb_build_array(new_lead);
      else
        account_key:=parent.account_id;
        update public.leads set source_payload=new_lead,status_code='계약 완료',projected_revision=revision,row_version=row_version+1,updated_at=now() where id=parent.id;
        select jsonb_agg(case when x->>'id'=lead_key then new_lead else x end order by ord) into working from jsonb_array_elements(working) with ordinality v(x,ord);
        patches:=patches||jsonb_build_array(jsonb_build_object('id',lead_key,'ops',(select jsonb_agg(jsonb_build_object('op','set','path',jsonb_build_array(key),'value',value)) from jsonb_each(new_lead) where value is distinct from old_lead->key)));
      end if;
      changed_ids:=array_append(changed_ids,rel.id);
      if deal_key is null then
        insert into public.deals(organization_id,account_id,lead_id,source,source_row_key,service_code,stage_code,quoted_amount,contract_amount,contracted_on,source_payload,field_owners,state,projected_revision)
        values(p_organization_id,account_key,rel.id,'GOOGLE_SHEETS','deal:'||lead_key,nullif(item->>'service',''),'계약 완료',coalesce((new_lead->>'expected')::numeric,0),amount,(item->>'contractDate')::date,new_lead,'{}','ACTIVE',revision) returning id into deal_key;
        new_deals:=new_deals+1;
      else
        update public.deals set stage_code='계약 완료',contract_amount=amount,contracted_on=(item->>'contractDate')::date,source_payload=new_lead,
          projected_revision=revision,row_version=row_version+1,updated_at=now() where id=deal_key;
      end if;
      changed_deals:=array_append(changed_deals,deal_key);
      for payment in select value from jsonb_array_elements(new_lead->'payments') loop
        payment_key:='payment:'||lead_key||':'||(payment->>'id');
        insert into public.payment_plans(organization_id,deal_id,installment_code,planned_amount,due_on,status,source,source_row_key,field_owners,projected_revision)
        values(p_organization_id,deal_key,payment->>'label',(payment->>'amount')::numeric,null,case when payment->>'paidConfirmed'='true' then 'PAID'::public.kpi_payment_status else 'PLANNED'::public.kpi_payment_status end,'GOOGLE_SHEETS',payment_key,'{}',revision) returning id into plan_key;
        if payment->>'paidConfirmed'='true' then
          insert into public.payment_receipts(organization_id,payment_plan_id,deal_id,received_amount,received_on,source,source_row_key,projected_revision)
          values(p_organization_id,plan_key,deal_key,(payment->>'amount')::numeric,paid_at,'GOOGLE_SHEETS','receipt:'||payment_key,revision);
        end if;
      end loop;
      if not exists(select 1 from public.deals d where d.id=deal_key and d.contract_amount=amount and d.contracted_on=(item->>'contractDate')::date and d.source_payload=new_lead
        and (select sum(planned_amount) from public.payment_plans where deal_id=d.id and archived_at is null)=amount
        and (select sum(received_amount) from public.payment_receipts where deal_id=d.id and archived_at is null)=paid
        and (select count(*) from public.payment_plans where deal_id=d.id and status='PAID' and archived_at is null)=1
        and exists(select 1 from public.payment_receipts where deal_id=d.id and received_amount=paid and received_on is not distinct from paid_at)) then raise exception 'NOVEMBER_REPAIR_LEDGER_MISMATCH'; end if;
      log:=jsonb_build_object('id',revision||':'||(item->>'keyHash'),'at',now(),'date',(now() at time zone 'Asia/Seoul')::date,'company',new_lead->>'company','leadId',lead_key,
        'action','시트 입금 확인 반영','source','계약 프로세스 시트','actor','관리자 승인','detail','사용자 승인 11월 계약·확인 입금·완료 체크 대조 반영',
        'meta',jsonb_build_object('sourceHash',p_source_hash,'sourceRow',item->'row','keyHash',item->>'keyHash','before',jsonb_build_object('paid',coalesce(old_lead->'paid','0'::jsonb),'contractAmount',coalesce(old_lead->'contractAmount','0'::jsonb)),
        'after',jsonb_build_object('paid',paid,'contractAmount',amount,'paidAt',coalesce(paid_at::text,''),'confirmedCount',1,'paymentCount',jsonb_array_length(new_lead->'payments'))));
      logs:=logs||jsonb_build_array(log);
      insert into public.deal_activity(organization_id,deal_id,action_code,path,detail,metadata,source,occurred_at,source_row_key)
      values(p_organization_id,deal_key,log->>'action',log->>'source',log->>'detail',log->'meta','GOOGLE_SHEETS',now(),'contract-status:'||(log->>'id'));
      results:=results||jsonb_build_array(jsonb_build_object('keyHash',item->>'keyHash','sourceRow',item->'row','contractDate',item->>'contractDate','contractAmount',amount,'paid',paid,'paidAt',coalesce(paid_at::text,''),'confirmedCount',1,'paymentCount',jsonb_array_length(new_lead->'payments'),'mode',item->>'mode'));
    end loop;
    if jsonb_array_length(results)<>14 then raise exception 'NOVEMBER_REPAIR_INCOMPLETE'; end if;
    next_state:=old_state||jsonb_build_object('leads',working,'contractStatusLogs',coalesce(old_state->'contractStatusLogs','[]')||logs);
    mutation:=jsonb_build_object('origin','november_user_payment_repair','reason','explicit_confirmed_contracts','collections',jsonb_build_object(
      'leads',jsonb_build_object('idField','id','upsert',upserts,'patches',patches),'contractStatusLogs',jsonb_build_object('idField','id','upsert',logs)));
    insert into public.idempotency_keys(organization_id,key,operation,request_hash,status) values(p_organization_id,revision,'SUPABASE_DOMAIN_MUTATION',md5(mutation::text),'PREPARE');
    update public.app_current_state set primary_revision=revision,state_snapshot=next_state,source_mutation_id=revision,updated_at=now() where organization_id=p_organization_id;
    insert into public.app_state_daily_checkpoints(organization_id,checkpoint_date,primary_revision,state_snapshot,source_mutation_id)
    values(p_organization_id,(now() at time zone 'Asia/Seoul')::date,revision,next_state,revision) on conflict(organization_id,checkpoint_date)do nothing;
    update public.leads set projected_revision=revision where organization_id=p_organization_id and archived_at is null;
    update public.app_documents set projected_revision=revision where organization_id=p_organization_id;
    insert into public.app_documents(organization_id,document_key,document_value,projected_revision,updated_at)
    values(p_organization_id,'contractStatusLogs',next_state->'contractStatusLogs',revision,now()) on conflict(organization_id,document_key)do update set document_value=excluded.document_value,projected_revision=excluded.projected_revision,updated_at=excluded.updated_at;
    insert into public.app_state_projections(organization_id,primary_revision,status,entity_counts,financial_totals,projected_at)
    select p_organization_id,revision,'CURRENT',jsonb_build_object(
      'accounts',(select count(*) from public.accounts where organization_id=p_organization_id and archived_at is null),
      'leads',(select count(*) from public.leads where organization_id=p_organization_id and archived_at is null),
      'deals',(select count(*) from public.deals where organization_id=p_organization_id and archived_at is null),
      'payments',(select count(*) from public.payment_plans where organization_id=p_organization_id and archived_at is null),
      'paymentReceipts',(select count(*) from public.payment_receipts where organization_id=p_organization_id and archived_at is null),
      'contractEvents',(select count(*) from public.contract_events where organization_id=p_organization_id and archived_at is null),
      'marketingDaily',(select count(*) from public.marketing_daily_spend where organization_id=p_organization_id and archived_at is null)),
      jsonb_build_object('quotedAmount',coalesce(sum(quoted_amount),0),'contractAmount',coalesce(sum(contract_amount),0),
      'receivedAmount',(select coalesce(sum(received_amount),0) from public.payment_receipts where organization_id=p_organization_id and archived_at is null),
      'marketingSpend',(select coalesce(sum(spend_amount),0) from public.marketing_daily_spend where organization_id=p_organization_id and archived_at is null)),now()
    from public.deals where organization_id=p_organization_id and archived_at is null
    on conflict(organization_id)do update set primary_revision=excluded.primary_revision,status=excluded.status,entity_counts=excluded.entity_counts,
      financial_totals=excluded.financial_totals,projected_at=excluded.projected_at,error_detail=null;
    -- Exact existing-row preservation. No old receipt/date/amount/plan/account can change.
    if exists(select 1 from jsonb_array_elements(before_accounts)o where not exists(select 1 from public.accounts x where x.organization_id=p_organization_id and to_jsonb(x)=o)) then raise exception 'NOVEMBER_REPAIR_OLD_ACCOUNT_CHANGED'; end if;
    if exists(select 1 from jsonb_array_elements(before_plans)o where not exists(select 1 from public.payment_plans x where x.organization_id=p_organization_id and to_jsonb(x)=o)) then raise exception 'NOVEMBER_REPAIR_OLD_PLAN_CHANGED'; end if;
    if exists(select 1 from jsonb_array_elements(before_receipts)o where not exists(select 1 from public.payment_receipts x where x.organization_id=p_organization_id and to_jsonb(x)=o)) then raise exception 'NOVEMBER_REPAIR_OLD_RECEIPT_CHANGED'; end if;
    if exists(select 1 from jsonb_array_elements(before_events)o where not exists(select 1 from public.contract_events x where x.organization_id=p_organization_id and to_jsonb(x)=o)) then raise exception 'NOVEMBER_REPAIR_OLD_EVENT_CHANGED'; end if;
    if exists(select 1 from jsonb_array_elements(before_deals)o where not exists(select 1 from public.deals x where x.organization_id=p_organization_id and x.id::text=o->>'id' and
      case when x.id=any(changed_deals) then to_jsonb(x)-array['stage_code','contract_amount','contracted_on','source_payload','projected_revision','row_version','updated_at']=o-array['stage_code','contract_amount','contracted_on','source_payload','projected_revision','row_version','updated_at'] else to_jsonb(x)=o end)) then raise exception 'NOVEMBER_REPAIR_OLD_DEAL_CHANGED'; end if;
    if exists(select 1 from jsonb_array_elements(before_leads)o where not exists(select 1 from public.leads x where x.organization_id=p_organization_id and x.id::text=o->>'id' and
      case when o->>'archived_at' is not null then to_jsonb(x)=o when x.id=any(changed_ids) then to_jsonb(x)-array['source_payload','status_code','projected_revision','row_version','updated_at']=o-array['source_payload','status_code','projected_revision','row_version','updated_at'] else to_jsonb(x)-'projected_revision'=o-'projected_revision' end)) then raise exception 'NOVEMBER_REPAIR_OTHER_LEAD_CHANGED'; end if;
    if next_state-array['leads','contractStatusLogs'] is distinct from old_state-array['leads','contractStatusLogs'] or
      (select coalesce(jsonb_object_agg(document_key,document_value),'{}') from public.app_documents where organization_id=p_organization_id and document_key<>'contractStatusLogs') is distinct from before_docs-'contractStatusLogs' then raise exception 'NOVEMBER_REPAIR_OTHER_DOCUMENT_CHANGED'; end if;
    if exists(select 1 from public.leads l where l.organization_id=p_organization_id and l.archived_at is null and
      (l.projected_revision<>revision or not exists(select 1 from jsonb_array_elements(working)x where x=l.source_payload))) then raise exception 'NOVEMBER_REPAIR_FINAL_SNAPSHOT_MISMATCH'; end if;
    insert into public.shadow_mutation_queue(organization_id,mutation_id,primary_revision,mutation,state_snapshot,field_ownership_claims,status,attempts,committed_at)
    values(p_organization_id,revision,revision,mutation,null,'[]','COMMITTED',1,now());
    result:=jsonb_build_object('ok',true,'revision',revision,'baseRevision',p_base_revision,'targetCount',14,'newLeads',new_leads,'updatedLeads',updated_leads,'newDeals',new_deals,
      'sourceHash',p_source_hash,'sourceCheckedAt',p_fetched_at,'databaseCheckedAt',clock_timestamp(),'outsideScopeRowsExact',true,'existingReceiptsExact',true,'archivedRowsExact',true,
      'snapshotLedgerVerified',true,'rehearsal',p_dry_run,'targets',results);
    insert into public.audit_events(organization_id,entity_type,action_code,source,idempotency_key,metadata) values(p_organization_id,'domain_mutation','COMMITTED','SYSTEM',revision,result);
    update public.idempotency_keys set status='COMMIT',updated_at=now(),response=result where organization_id=p_organization_id and key=revision;
    if p_dry_run then raise sqlstate 'PZ001'; end if;
  exception when sqlstate 'PZ001' then return result;
  end;
  return result;
end;
$repair$;
revoke all on function public.kpi_repair_november_confirmed_contracts(uuid,text,text,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.kpi_repair_november_confirmed_contracts(uuid,text,text,timestamptz,jsonb,boolean) to service_role;
