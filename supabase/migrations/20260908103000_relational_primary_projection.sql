begin;

create table public.app_current_state (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  primary_revision text not null,
  state_snapshot jsonb not null check (jsonb_typeof(state_snapshot) = 'object'),
  source_mutation_id text not null,
  updated_at timestamptz not null default now()
);

create table public.app_state_daily_checkpoints (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  checkpoint_date date not null,
  primary_revision text not null,
  state_snapshot jsonb not null check (jsonb_typeof(state_snapshot) = 'object'),
  source_mutation_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, checkpoint_date)
);

create table public.app_state_projections (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  primary_revision text not null,
  status text not null check (status in ('CURRENT','FAILED')),
  entity_counts jsonb not null default '{}'::jsonb,
  financial_totals jsonb not null default '{}'::jsonb,
  projected_at timestamptz not null default now(),
  error_detail text
);

alter table public.accounts add column projected_revision text;
alter table public.leads add column projected_revision text;
alter table public.deals add column projected_revision text;
alter table public.payment_plans add column projected_revision text;
alter table public.payment_receipts add column projected_revision text;
alter table public.marketing_daily_spend add column projected_revision text;

create index crm_raw_records_sync_run_idx on public.crm_raw_records(sync_run_id);

alter table public.app_current_state enable row level security;
alter table public.app_current_state force row level security;
alter table public.app_state_daily_checkpoints enable row level security;
alter table public.app_state_daily_checkpoints force row level security;
alter table public.app_state_projections enable row level security;
alter table public.app_state_projections force row level security;
revoke all on public.app_current_state, public.app_state_daily_checkpoints, public.app_state_projections from anon, authenticated;

create or replace function private.kpi_try_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare v_clean text;
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  v_clean := pg_catalog.regexp_replace(p_value, '[^0-9.\-]', '', 'g');
  if v_clean in ('', '-', '.', '-.') then return null; end if;
  return v_clean::numeric;
exception when others then return null;
end;
$$;

create or replace function private.kpi_try_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  if p_value ~ '^\d{4}-\d{2}-\d{2}' then return substring(p_value from 1 for 10)::date; end if;
  return p_value::date;
exception when others then return null;
end;
$$;

create or replace function private.kpi_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return p_value::timestamptz;
exception when others then return null;
end;
$$;

create or replace function private.project_v3_state(
  p_organization_id uuid,
  p_revision text,
  p_state jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
  v_totals jsonb;
begin
  if p_organization_id is null or nullif(btrim(p_revision), '') is null
     or jsonb_typeof(p_state) <> 'object'
     or jsonb_typeof(coalesce(p_state->'leads', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_v3_projection_input';
  end if;

  with source_rows as (
    select lead,
      coalesce(nullif(btrim(lead->>'id'), ''),
        case when nullif(btrim(lead->>'projNo'), '') is not null then 'crm-' || btrim(lead->>'projNo') end,
        'sheet-lead-' || ordinality::text) as lead_key,
      nullif(btrim(lead->>'projNo'), '') as external_crm_id
    from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) with ordinality as x(lead, ordinality)
  )
  insert into public.accounts
    (organization_id, name, normalized_name, external_crm_id, source, source_row_key,
     source_payload, field_owners, state, archived_at, projected_revision, updated_at)
  select p_organization_id,
    coalesce(nullif(btrim(lead->>'company'), ''), '이름 미입력'),
    lower(coalesce(nullif(btrim(lead->>'company'), ''), '이름 미입력')),
    external_crm_id,
    case when external_crm_id is null then 'GOOGLE_SHEETS'::public.kpi_source else 'CRM'::public.kpi_source end,
    'account:' || lead_key,
    jsonb_build_object('projection', 'v3-state', 'leadKey', lead_key),
    jsonb_build_object('name', case when external_crm_id is null then 'USER' else 'CRM' end),
    'ACTIVE'::public.kpi_record_state, null, p_revision, now()
  from source_rows
  on conflict (organization_id, source, source_row_key) do update set
    name = excluded.name, normalized_name = excluded.normalized_name,
    external_crm_id = excluded.external_crm_id, source_payload = excluded.source_payload,
    field_owners = excluded.field_owners, state = 'ACTIVE', archived_at = null,
    projected_revision = excluded.projected_revision, updated_at = now();

  update public.accounts set state = 'ARCHIVED', archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with source_rows as (
    select lead,
      coalesce(nullif(btrim(lead->>'id'), ''),
        case when nullif(btrim(lead->>'projNo'), '') is not null then 'crm-' || btrim(lead->>'projNo') end,
        'sheet-lead-' || ordinality::text) as lead_key,
      nullif(btrim(lead->>'projNo'), '') as external_crm_id
    from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) with ordinality as x(lead, ordinality)
  )
  insert into public.leads
    (organization_id, account_id, external_crm_id, source, source_row_key, acquired_on, channel,
     status_code, premeeting_scheduled_at, premeeting_completed_at, notes, source_payload,
     field_owners, state, archived_at, projected_revision, updated_at)
  select p_organization_id, a.id, s.external_crm_id,
    case when s.external_crm_id is null then 'GOOGLE_SHEETS'::public.kpi_source else 'CRM'::public.kpi_source end,
    'lead:' || s.lead_key, private.kpi_try_date(s.lead->>'createdAt'), nullif(btrim(s.lead->>'channel'), ''),
    coalesce(nullif(btrim(s.lead->>'status'), ''), 'UNKNOWN'),
    coalesce(private.kpi_try_timestamptz(s.lead->>'premeetingAt'), private.kpi_try_timestamptz(s.lead->>'bookedAt')),
    private.kpi_try_timestamptz(s.lead->>'premeetingDoneAt'), nullif(btrim(s.lead->>'memo'), ''),
    jsonb_build_object('projection', 'v3-state', 'leadKey', s.lead_key),
    jsonb_build_object('statusCode', 'USER', 'notes', 'USER', 'channel', case when s.external_crm_id is null then 'USER' else 'CRM' end),
    'ACTIVE'::public.kpi_record_state, null, p_revision, now()
  from source_rows s
  join public.accounts a on a.organization_id = p_organization_id
    and a.source_row_key = 'account:' || s.lead_key and a.archived_at is null
  on conflict (organization_id, source, source_row_key) do update set
    account_id = excluded.account_id, external_crm_id = excluded.external_crm_id,
    acquired_on = excluded.acquired_on, channel = excluded.channel, status_code = excluded.status_code,
    premeeting_scheduled_at = excluded.premeeting_scheduled_at,
    premeeting_completed_at = excluded.premeeting_completed_at, notes = excluded.notes,
    source_payload = excluded.source_payload, field_owners = excluded.field_owners,
    row_version = public.leads.row_version + 1, state = 'ACTIVE', archived_at = null,
    projected_revision = excluded.projected_revision, updated_at = now();

  update public.leads set state = 'ARCHIVED', archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with source_rows as (
    select lead,
      coalesce(nullif(btrim(lead->>'id'), ''),
        case when nullif(btrim(lead->>'projNo'), '') is not null then 'crm-' || btrim(lead->>'projNo') end,
        'sheet-lead-' || ordinality::text) as lead_key,
      nullif(btrim(lead->>'projNo'), '') as external_crm_id
    from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) with ordinality as x(lead, ordinality)
  ), deal_rows as (
    select * from source_rows
    where coalesce(nullif(btrim(lead->>'status'), ''), '신규 DB') <> '신규 DB'
       or coalesce(private.kpi_try_numeric(lead->>'contractAmount'), 0) > 0
       or coalesce(private.kpi_try_numeric(lead->>'expected'), 0) > 0
       or case when jsonb_typeof(lead->'payments') = 'array' then jsonb_array_length(lead->'payments') > 0 else false end
       or nullif(btrim(lead->>'contractAt'), '') is not null
  )
  insert into public.deals
    (organization_id, account_id, lead_id, external_crm_id, source, source_row_key, service_code,
     stage_code, quoted_amount, contract_amount, contracted_on, source_payload, field_owners,
     state, archived_at, projected_revision, updated_at)
  select p_organization_id, a.id, l.id, d.external_crm_id, 'GOOGLE_SHEETS'::public.kpi_source,
    'deal:' || d.lead_key, nullif(btrim(d.lead->>'buildup'), ''),
    coalesce(nullif(btrim(d.lead->>'status'), ''), 'UNKNOWN'),
    private.kpi_try_numeric(d.lead->>'expected'), private.kpi_try_numeric(d.lead->>'contractAmount'),
    private.kpi_try_date(d.lead->>'contractAt'),
    jsonb_build_object('projection', 'v3-state', 'leadKey', d.lead_key),
    jsonb_build_object('quotedAmount', 'USER', 'contractAmount', 'USER', 'contractedOn', 'USER', 'stageCode', 'USER'),
    'ACTIVE'::public.kpi_record_state, null, p_revision, now()
  from deal_rows d
  join public.accounts a on a.organization_id = p_organization_id and a.source_row_key = 'account:' || d.lead_key
  join public.leads l on l.organization_id = p_organization_id and l.source_row_key = 'lead:' || d.lead_key
  on conflict (organization_id, source, source_row_key) do update set
    account_id = excluded.account_id, lead_id = excluded.lead_id, external_crm_id = excluded.external_crm_id,
    service_code = excluded.service_code, stage_code = excluded.stage_code,
    quoted_amount = excluded.quoted_amount, contract_amount = excluded.contract_amount,
    contracted_on = excluded.contracted_on, source_payload = excluded.source_payload,
    field_owners = excluded.field_owners, row_version = public.deals.row_version + 1,
    state = 'ACTIVE', archived_at = null, projected_revision = excluded.projected_revision, updated_at = now();

  update public.deals set state = 'ARCHIVED', archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with source_rows as (
    select lead,
      coalesce(nullif(btrim(lead->>'id'), ''),
        case when nullif(btrim(lead->>'projNo'), '') is not null then 'crm-' || btrim(lead->>'projNo') end,
        'sheet-lead-' || ordinality::text) as lead_key
    from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) with ordinality as x(lead, ordinality)
  ), payment_rows as (
    select s.lead_key, payment,
      'payment:' || s.lead_key || ':' || coalesce(nullif(btrim(payment->>'id'), ''), payment_ord::text) as payment_key,
      payment_ord
    from source_rows s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.lead->'payments') = 'array' then s.lead->'payments' else '[]'::jsonb end) with ordinality as p(payment, payment_ord)
  )
  insert into public.payment_plans
    (organization_id, deal_id, installment_code, planned_amount, due_on, status, source,
     source_row_key, field_owners, archived_at, projected_revision, updated_at)
  select p_organization_id, d.id,
    coalesce(nullif(btrim(p.payment->>'kind'), ''), nullif(btrim(p.payment->>'label'), ''),
      nullif(btrim(p.payment->>'no'), ''), 'INSTALLMENT_' || p.payment_ord::text),
    coalesce(private.kpi_try_numeric(p.payment->>'amount'), 0), private.kpi_try_date(p.payment->>'dueAt'),
    case when lower(coalesce(p.payment->>'paidConfirmed', 'false')) = 'true'
           or nullif(btrim(p.payment->>'paidAt'), '') is not null
      then 'PAID'::public.kpi_payment_status else 'PLANNED'::public.kpi_payment_status end,
    'GOOGLE_SHEETS'::public.kpi_source, p.payment_key,
    jsonb_build_object('plannedAmount', 'USER', 'dueOn', 'USER', 'status', 'USER'),
    null, p_revision, now()
  from payment_rows p
  join public.deals d on d.organization_id = p_organization_id and d.source_row_key = 'deal:' || p.lead_key
  on conflict (organization_id, source, source_row_key) do update set
    deal_id = excluded.deal_id, installment_code = excluded.installment_code,
    planned_amount = excluded.planned_amount, due_on = excluded.due_on, status = excluded.status,
    field_owners = excluded.field_owners, row_version = public.payment_plans.row_version + 1,
    archived_at = null, projected_revision = excluded.projected_revision, updated_at = now();

  update public.payment_plans set archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with source_rows as (
    select lead,
      coalesce(nullif(btrim(lead->>'id'), ''),
        case when nullif(btrim(lead->>'projNo'), '') is not null then 'crm-' || btrim(lead->>'projNo') end,
        'sheet-lead-' || ordinality::text) as lead_key
    from jsonb_array_elements(coalesce(p_state->'leads', '[]'::jsonb)) with ordinality as x(lead, ordinality)
  ), payment_rows as (
    select s.lead_key, s.lead, payment,
      'payment:' || s.lead_key || ':' || coalesce(nullif(btrim(payment->>'id'), ''), payment_ord::text) as payment_key
    from source_rows s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.lead->'payments') = 'array' then s.lead->'payments' else '[]'::jsonb end) with ordinality as p(payment, payment_ord)
  ), confirmed as (
    select lead_key, lead, payment_key, payment,
      coalesce(private.kpi_try_numeric(payment->>'amount'), 0) amount
    from payment_rows
    where lower(coalesce(payment->>'paidConfirmed', 'false')) = 'true'
       or nullif(btrim(payment->>'paidAt'), '') is not null
  ), confirmed_totals as (
    select lead_key, sum(amount) total from confirmed group by lead_key
  ), receipt_rows as (
    select c.lead_key, c.payment_key, 'receipt:' || c.payment_key as receipt_key, c.amount,
      coalesce(private.kpi_try_date(c.payment->>'paidAt'), private.kpi_try_date(c.payment->>'updatedAt'),
        private.kpi_try_date(c.lead->>'contractAt'), private.kpi_try_date(c.lead->>'createdAt')) received_on,
      nullif(btrim(c.payment->>'method'), '') method, nullif(btrim(c.payment->>'memo'), '') note
    from confirmed c
    union all
    select s.lead_key, null,
      'receipt:deal:' || s.lead_key || ':paid-residual',
      coalesce(private.kpi_try_numeric(s.lead->>'paid'), 0) - coalesce(ct.total, 0),
      coalesce(private.kpi_try_date(s.lead->>'contractAt'), private.kpi_try_date(s.lead->>'createdAt')),
      null, 'V3 lead.paid에서 완료 회차 합계를 제외한 잔여 실입금'
    from source_rows s left join confirmed_totals ct using (lead_key)
    where coalesce(private.kpi_try_numeric(s.lead->>'paid'), 0) > coalesce(ct.total, 0)
  )
  insert into public.payment_receipts
    (organization_id, payment_plan_id, deal_id, received_amount, received_on, payment_method,
     note, source, source_row_key, archived_at, projected_revision)
  select p_organization_id, pp.id, d.id, r.amount, r.received_on, r.method, r.note,
    'GOOGLE_SHEETS'::public.kpi_source, r.receipt_key, null, p_revision
  from receipt_rows r
  join public.deals d on d.organization_id = p_organization_id and d.source_row_key = 'deal:' || r.lead_key
  left join public.payment_plans pp on pp.organization_id = p_organization_id and pp.source_row_key = r.payment_key
  on conflict (organization_id, source, source_row_key) do update set
    payment_plan_id = excluded.payment_plan_id, deal_id = excluded.deal_id,
    received_amount = excluded.received_amount, received_on = excluded.received_on,
    payment_method = excluded.payment_method, note = excluded.note,
    archived_at = null, projected_revision = excluded.projected_revision;

  update public.payment_receipts set archived_at = coalesce(archived_at, now())
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with event_rows as (
    select event,
      nullif(btrim(coalesce(event->>'sourceKey', event->>'id')), '') source_row_key,
      nullif(btrim(event->>'sourceHash'), '') source_hash,
      'deal:' || btrim(event->>'leadId') deal_key
    from jsonb_array_elements(coalesce(p_state->'contractEvents', '[]'::jsonb)) event
  )
  insert into public.contract_events
    (organization_id, deal_id, event_type, event_at, contract_amount, confirmed_receipt_amount,
     source, source_row_key, source_hash, payload)
  select p_organization_id, d.id, 'CONTRACT_IMPORTED',
    coalesce(private.kpi_try_timestamptz(e.event->>'appliedAt'),
      private.kpi_try_timestamptz(e.event->>'lastDate'), private.kpi_try_timestamptz(e.event->>'firstDate')),
    private.kpi_try_numeric(e.event->>'amount'), private.kpi_try_numeric(e.event->>'numericPaid'),
    'GOOGLE_SHEETS'::public.kpi_source, e.source_row_key, e.source_hash,
    jsonb_build_object('sourceRows', coalesce(e.event->'sourceRows', '[]'::jsonb),
      'paymentChecked', coalesce(e.event->'paymentChecked', 'false'::jsonb))
  from event_rows e
  join public.deals d on d.organization_id = p_organization_id and d.source_row_key = e.deal_key
  where e.source_row_key is not null
    and coalesce(private.kpi_try_timestamptz(e.event->>'appliedAt'),
      private.kpi_try_timestamptz(e.event->>'lastDate'), private.kpi_try_timestamptz(e.event->>'firstDate')) is not null
  on conflict (organization_id, source, source_row_key, source_hash) do nothing;

  with provider_rows as (
    select case when provider_name = 'GOOGLE' then 'GOOGLE_ADS' else provider_name end provider,
      row_data
    from jsonb_each(coalesce(p_state->'adDaily', '{}'::jsonb)) providers(provider_name, rows_data)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(rows_data) = 'array' then rows_data else '[]'::jsonb end) row_data
  ), marketing_rows as (
    select provider, row_data, provider channel_code,
      private.kpi_try_numeric(row_data->>'spend') spend_amount
    from provider_rows where provider <> 'META'
    union all
    select provider, row_data, 'META_LEAD', private.kpi_try_numeric(row_data->>'leadSpend')
    from provider_rows where provider = 'META'
    union all
    select provider, row_data, 'META_POCKET_TRAFFIC', private.kpi_try_numeric(row_data->>'pocketTrafficSpend')
    from provider_rows where provider = 'META' and lower(coalesce(row_data->>'trafficDetailReady', 'false')) = 'true'
    union all
    select provider, row_data, 'META_BUILDER_TRAFFIC', private.kpi_try_numeric(row_data->>'builderTrafficSpend')
    from provider_rows where provider = 'META' and lower(coalesce(row_data->>'trafficDetailReady', 'false')) = 'true'
    union all
    select provider, row_data, 'META_TRAFFIC_UNSPLIT', private.kpi_try_numeric(row_data->>'trafficSpend')
    from provider_rows where provider = 'META' and lower(coalesce(row_data->>'trafficDetailReady', 'false')) <> 'true'
  )
  insert into public.marketing_daily_spend
    (organization_id, spend_date, provider, channel_code, campaign_external_id, spend_amount,
     impressions, clicks, conversions, source_row_key, payload, archived_at, projected_revision, updated_at)
  select p_organization_id, private.kpi_try_date(m.row_data->>'date'), m.provider::public.kpi_source,
    m.channel_code, null, coalesce(m.spend_amount, 0),
    private.kpi_try_numeric(m.row_data->>'impressions')::bigint,
    private.kpi_try_numeric(m.row_data->>'clicks')::bigint,
    private.kpi_try_numeric(m.row_data->>'crm'),
    'ad:' || m.provider || ':' || btrim(m.row_data->>'date') || ':' || m.channel_code,
    jsonb_build_object('projection', 'v3-state'), null, p_revision, now()
  from marketing_rows m where private.kpi_try_date(m.row_data->>'date') is not null
  on conflict (organization_id, provider, spend_date, campaign_external_id, source_row_key) do update set
    channel_code = excluded.channel_code, spend_amount = excluded.spend_amount,
    impressions = excluded.impressions, clicks = excluded.clicks, conversions = excluded.conversions,
    payload = excluded.payload, archived_at = null, projected_revision = excluded.projected_revision, updated_at = now();

  update public.marketing_daily_spend set archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with activity_rows as (
    select log,
      nullif(btrim(log->>'id'), '') log_id,
      case when nullif(btrim(log->>'leadId'), '') is not null then 'deal:' || btrim(log->>'leadId') end deal_key
    from jsonb_array_elements(coalesce(p_state->'contractStatusLogs', '[]'::jsonb)) log
  )
  insert into public.deal_activity
    (organization_id, deal_id, action_code, path, detail, metadata, source,
     occurred_at, source_row_key)
  select p_organization_id, d.id, coalesce(nullif(btrim(a.log->>'action'), ''), 'UNKNOWN'),
    nullif(btrim(a.log->>'source'), ''), nullif(btrim(a.log->>'detail'), ''),
    coalesce(a.log->'meta', '{}'::jsonb), 'GOOGLE_SHEETS'::public.kpi_source,
    coalesce(private.kpi_try_timestamptz(a.log->>'at'), private.kpi_try_timestamptz(a.log->>'date')),
    'contract-status:' || a.log_id
  from activity_rows a
  left join public.deals d on d.organization_id = p_organization_id and d.source_row_key = a.deal_key
  where a.log_id is not null
    and coalesce(private.kpi_try_timestamptz(a.log->>'at'), private.kpi_try_timestamptz(a.log->>'date')) is not null
  on conflict (organization_id, source, source_row_key) do nothing;

  select jsonb_build_object(
    'accounts', (select count(*) from public.accounts where organization_id=p_organization_id and archived_at is null),
    'leads', (select count(*) from public.leads where organization_id=p_organization_id and archived_at is null),
    'deals', (select count(*) from public.deals where organization_id=p_organization_id and archived_at is null),
    'payments', (select count(*) from public.payment_plans where organization_id=p_organization_id and archived_at is null),
    'paymentReceipts', (select count(*) from public.payment_receipts where organization_id=p_organization_id and archived_at is null),
    'contractEvents', (select count(distinct coalesce(source_hash, id::text)) from public.contract_events where organization_id=p_organization_id and archived_at is null),
    'marketingDaily', (select count(*) from public.marketing_daily_spend where organization_id=p_organization_id and archived_at is null),
    'dealActivity', (select count(*) from public.deal_activity where organization_id=p_organization_id)
  ) into v_counts;

  select jsonb_build_object(
    'quotedAmount', coalesce(sum(quoted_amount),0),
    'contractAmount', coalesce(sum(contract_amount),0),
    'receivedAmount', (select coalesce(sum(received_amount),0) from public.payment_receipts where organization_id=p_organization_id and archived_at is null),
    'marketingSpend', (select coalesce(sum(spend_amount),0) from public.marketing_daily_spend where organization_id=p_organization_id and archived_at is null)
  ) into v_totals
  from public.deals where organization_id=p_organization_id and archived_at is null;

  insert into public.app_state_projections
    (organization_id, primary_revision, status, entity_counts, financial_totals, projected_at, error_detail)
  values (p_organization_id, p_revision, 'CURRENT', v_counts, v_totals, now(), null)
  on conflict (organization_id) do update set
    primary_revision=excluded.primary_revision, status=excluded.status,
    entity_counts=excluded.entity_counts, financial_totals=excluded.financial_totals,
    projected_at=excluded.projected_at, error_detail=null;

  return jsonb_build_object('ok', true, 'revision', p_revision, 'counts', v_counts, 'totals', v_totals);
end;
$$;

insert into public.app_current_state
  (organization_id, primary_revision, state_snapshot, source_mutation_id, updated_at)
select distinct on (organization_id)
  organization_id, primary_revision, state_snapshot, source_mutation_id, created_at
from public.shadow_state_snapshots
order by organization_id, created_at desc, id desc;

insert into public.app_state_daily_checkpoints
  (organization_id, checkpoint_date, primary_revision, state_snapshot, source_mutation_id, created_at)
select organization_id, (updated_at at time zone 'Asia/Seoul')::date,
  primary_revision, state_snapshot, source_mutation_id, updated_at
from public.app_current_state;

create or replace function public.commit_primary_state(
  p_organization_id uuid,
  p_mutation_id text,
  p_base_revision text,
  p_next_revision text,
  p_request_hash text,
  p_mutation jsonb,
  p_state_snapshot jsonb,
  p_field_ownership_claims jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.idempotency_keys%rowtype;
  v_current_revision text;
  v_projection jsonb;
begin
  if p_organization_id is null or nullif(btrim(p_mutation_id), '') is null
     or nullif(btrim(p_next_revision), '') is null
     or jsonb_typeof(p_mutation) <> 'object'
     or jsonb_typeof(p_state_snapshot) <> 'object'
     or jsonb_typeof(p_field_ownership_claims) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_primary_commit');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));

  select * into v_existing from public.idempotency_keys
  where organization_id = p_organization_id and key = p_mutation_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    end if;
    return coalesce(v_existing.response, '{}'::jsonb) || jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select primary_revision into v_current_revision from public.app_current_state
  where organization_id = p_organization_id for update;
  if v_current_revision is distinct from p_base_revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflict', 'currentRevision', v_current_revision);
  end if;

  insert into public.idempotency_keys
    (organization_id, key, operation, request_hash, status)
  values (p_organization_id, p_mutation_id, 'SUPABASE_PRIMARY_V2', p_request_hash, 'PREPARE');

  insert into public.app_current_state
    (organization_id, primary_revision, state_snapshot, source_mutation_id, updated_at)
  values (p_organization_id, p_next_revision, p_state_snapshot, p_mutation_id, now())
  on conflict (organization_id) do update set
    primary_revision=excluded.primary_revision, state_snapshot=excluded.state_snapshot,
    source_mutation_id=excluded.source_mutation_id, updated_at=excluded.updated_at;

  insert into public.app_state_daily_checkpoints
    (organization_id, checkpoint_date, primary_revision, state_snapshot, source_mutation_id)
  values (p_organization_id, (now() at time zone 'Asia/Seoul')::date,
    p_next_revision, p_state_snapshot, p_mutation_id)
  on conflict (organization_id, checkpoint_date) do nothing;

  v_projection := private.project_v3_state(p_organization_id, p_next_revision, p_state_snapshot);

  insert into public.shadow_mutation_queue
    (organization_id, mutation_id, primary_revision, mutation, state_snapshot,
     field_ownership_claims, status, attempts, committed_at)
  values (p_organization_id, p_mutation_id, p_next_revision, p_mutation, null,
    p_field_ownership_claims, 'COMMITTED', 1, now());

  insert into public.audit_events
    (organization_id, entity_type, action_code, source, idempotency_key, metadata)
  values (p_organization_id, 'primary_state', 'COMMITTED', 'SYSTEM', p_mutation_id,
    jsonb_build_object('baseRevision', p_base_revision, 'nextRevision', p_next_revision,
      'relationsProjected', true));

  update public.idempotency_keys set status='COMMIT', updated_at=now(),
    response=jsonb_build_object('ok',true,'revision',p_next_revision,'relationsProjected',true)
  where organization_id=p_organization_id and key=p_mutation_id;

  return jsonb_build_object('ok',true,'revision',p_next_revision,
    'relationsProjected',true,'projection',v_projection);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','commit_conflict');
end;
$$;

revoke all on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb)
  to service_role;
revoke all on function private.project_v3_state(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function private.project_v3_state(uuid,text,jsonb) to service_role;

select private.project_v3_state(organization_id, primary_revision, state_snapshot)
from public.app_current_state;

comment on table public.app_current_state is 'Supabase operating source of truth: one current V3 application state per organization.';
comment on table public.app_state_daily_checkpoints is 'One immutable first-write checkpoint per Korea calendar day for disaster recovery.';
comment on table public.shadow_state_snapshots is 'Legacy per-mutation snapshots retained for rollback; no longer appended by primary V2 commits.';
comment on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb) is
  'Atomic revision-gated commit: current state, relational projection, mutation journal, and audit in one transaction.';

commit;
