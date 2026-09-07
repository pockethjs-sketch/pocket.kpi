begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create type public.kpi_member_role as enum ('OWNER','ADMIN','EDITOR','VIEWER','SERVICE');
create type public.kpi_source as enum ('USER','GOOGLE_SHEETS','CRM','META','NAVER','GOOGLE_ADS','SYSTEM');
create type public.kpi_record_state as enum ('ACTIVE','ARCHIVED');
create type public.kpi_sync_status as enum ('NEVER_RUN','RUNNING','SUCCESS','PARTIAL','FAILED','DISABLED');
create type public.kpi_migration_status as enum ('DRY_RUN','RUNNING','VERIFIED','FAILED','ROLLED_BACK');
create type public.kpi_payment_status as enum ('PLANNED','DUE','PARTIAL','PAID','CANCELLED');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  state public.kpi_record_state not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  email text, state public.kpi_record_state not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict, role public.kpi_member_role not null,
  state public.kpi_record_state not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, user_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 300), normalized_name text not null,
  external_crm_id text, source public.kpi_source not null, source_row_key text,
  source_payload jsonb not null default '{}'::jsonb, field_owners jsonb not null default '{}'::jsonb check (jsonb_typeof(field_owners)='object'),
  state public.kpi_record_state not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, external_crm_id), unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid references public.accounts(id) on delete restrict, external_crm_id text, source public.kpi_source not null, source_row_key text,
  acquired_on date, channel text, status_code text not null, owner_user_id uuid references public.profiles(id) on delete restrict,
  premeeting_scheduled_at timestamptz, premeeting_completed_at timestamptz, notes text,
  source_payload jsonb not null default '{}'::jsonb, field_owners jsonb not null default '{}'::jsonb check (jsonb_typeof(field_owners)='object'),
  row_version bigint not null default 1 check (row_version > 0), state public.kpi_record_state not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, external_crm_id), unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict, lead_id uuid references public.leads(id) on delete restrict,
  external_crm_id text, source public.kpi_source not null, source_row_key text, service_code text, stage_code text not null,
  quoted_amount numeric(18,2) check (quoted_amount is null or quoted_amount >= 0),
  contract_amount numeric(18,2) check (contract_amount is null or contract_amount >= 0),
  contracted_on date, owner_user_id uuid references public.profiles(id) on delete restrict,
  source_payload jsonb not null default '{}'::jsonb, field_owners jsonb not null default '{}'::jsonb check (jsonb_typeof(field_owners)='object'),
  row_version bigint not null default 1 check (row_version > 0), state public.kpi_record_state not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, external_crm_id), unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.contract_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict, event_type text not null, event_at timestamptz not null,
  contract_amount numeric(18,2) check (contract_amount is null or contract_amount >= 0),
  confirmed_receipt_amount numeric(18,2) check (confirmed_receipt_amount is null or confirmed_receipt_amount >= 0),
  source public.kpi_source not null, source_row_key text, source_hash text, payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete restrict, created_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, source, source_row_key, source_hash)
);

create table public.payment_plans (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict, installment_code text not null,
  planned_amount numeric(18,2) not null check (planned_amount >= 0), due_on date, status public.kpi_payment_status not null default 'PLANNED',
  source public.kpi_source not null, source_row_key text, field_owners jsonb not null default '{}'::jsonb,
  row_version bigint not null default 1 check (row_version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_plan_id uuid references public.payment_plans(id) on delete restrict, deal_id uuid not null references public.deals(id) on delete restrict,
  received_amount numeric(18,2) not null check (received_amount >= 0), received_on date not null, payment_method text, note text,
  source public.kpi_source not null, source_row_key text, external_transaction_id text, created_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, external_transaction_id), unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.deal_activity (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete restrict, account_id uuid references public.accounts(id) on delete restrict,
  action_code text not null, path text, detail text, metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.profiles(id) on delete restrict, source public.kpi_source not null, occurred_at timestamptz not null,
  source_row_key text, created_at timestamptz not null default now(), unique nulls not distinct (organization_id, source, source_row_key)
);

create table public.marketing_daily_spend (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  spend_date date not null, provider public.kpi_source not null check (provider in ('META','NAVER','GOOGLE_ADS')),
  channel_code text not null, campaign_external_id text, campaign_name text, spend_amount numeric(18,2) not null check (spend_amount >= 0),
  impressions bigint check (impressions is null or impressions >= 0), clicks bigint check (clicks is null or clicks >= 0), conversions numeric(18,4) check (conversions is null or conversions >= 0),
  source_row_key text, source_hash text, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique nulls not distinct (organization_id, provider, spend_date, campaign_external_id, source_row_key)
);

create table public.provider_sync_state (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  provider public.kpi_source not null, status public.kpi_sync_status not null default 'NEVER_RUN', checkpoint jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz, last_success_at timestamptz, latest_source_date date, row_count bigint check (row_count is null or row_count >= 0),
  amount_total numeric(18,2) check (amount_total is null or amount_total >= 0), error_code text, error_detail text, updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.idempotency_keys (
  organization_id uuid not null references public.organizations(id) on delete restrict, key text not null,
  operation text not null, request_hash text not null, status text not null check (status in ('PREPARE','COMMIT','FAILED')),
  response jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (organization_id, key)
);

create table public.entity_field_ownership (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  entity_type text not null, entity_id uuid not null, field_name text not null,
  owner_source public.kpi_source not null, claimed_at timestamptz not null default now(), claimed_by uuid references public.profiles(id) on delete restrict,
  primary key (organization_id, entity_type, entity_id, field_name)
);

create table public.audit_events (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete restrict,
  entity_type text not null, entity_id uuid, action_code text not null, actor_user_id uuid references public.profiles(id) on delete restrict,
  source public.kpi_source not null, idempotency_key text, before_data jsonb, after_data jsonb, metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.migration_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete restrict,
  source_name text not null, source_revision text, status public.kpi_migration_status not null, dry_run boolean not null default true,
  checkpoint jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), completed_at timestamptz,
  initiated_by uuid references public.profiles(id) on delete restrict, error_detail text
);

create table public.migration_reconciliation (
  id bigint generated always as identity primary key, migration_run_id uuid not null references public.migration_runs(id) on delete cascade,
  entity_type text not null, source_rows bigint not null check (source_rows >= 0), target_rows bigint not null check (target_rows >= 0),
  duplicate_rows bigint not null default 0 check (duplicate_rows >= 0), invalid_rows bigint not null default 0 check (invalid_rows >= 0),
  source_amount numeric(18,2), target_amount numeric(18,2), difference_amount numeric(18,2), details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_active_idx on public.organization_memberships(user_id, organization_id) where archived_at is null;
create index leads_org_acquired_idx on public.leads(organization_id, acquired_on) where archived_at is null;
create index deals_org_contract_idx on public.deals(organization_id, contracted_on, stage_code) where archived_at is null;
create index payment_plans_deal_due_idx on public.payment_plans(deal_id, due_on) where archived_at is null;
create index payment_receipts_deal_date_idx on public.payment_receipts(deal_id, received_on) where archived_at is null;
create index contract_events_deal_time_idx on public.contract_events(deal_id, event_at desc) where archived_at is null;
create index deal_activity_org_time_idx on public.deal_activity(organization_id, occurred_at desc);
create index marketing_spend_org_date_idx on public.marketing_daily_spend(organization_id, spend_date, provider) where archived_at is null;
create index audit_org_time_idx on public.audit_events(organization_id, occurred_at desc);

commit;
