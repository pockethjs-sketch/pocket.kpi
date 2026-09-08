create table public.crm_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_start date not null,
  requested_end date not null,
  status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  lead_count integer not null default 0 check (lead_count >= 0),
  meeting_count integer not null default 0 check (meeting_count >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.crm_raw_records (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sync_run_id uuid not null references public.crm_sync_runs(id) on delete restrict,
  record_type text not null check (record_type in ('LEAD','MEETING')),
  external_id text not null,
  source_date date,
  source_hash text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (organization_id, record_type, external_id, source_hash)
);

create index crm_raw_records_org_type_date_idx
  on public.crm_raw_records (organization_id, record_type, source_date desc);
create index crm_sync_runs_org_started_idx
  on public.crm_sync_runs (organization_id, started_at desc);

alter table public.crm_sync_runs enable row level security;
alter table public.crm_sync_runs force row level security;
alter table public.crm_raw_records enable row level security;
alter table public.crm_raw_records force row level security;

revoke all on public.crm_sync_runs from anon, authenticated;
revoke all on public.crm_raw_records from anon, authenticated;
revoke all on sequence public.crm_raw_records_id_seq from anon, authenticated;

comment on table public.crm_raw_records is
  'Append-only CRM source evidence. Edge service role writes; browser roles have no access.';
