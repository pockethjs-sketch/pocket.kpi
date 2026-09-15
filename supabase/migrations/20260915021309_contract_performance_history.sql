begin;
-- Historical monthly totals and detail rows have different evidence/coverage.
-- These tables never project into leads, deals, payments, or app_current_state.
create table public.contract_history_months (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_id text not null,
  reported_count integer not null check (reported_count >= 0),
  reported_amount numeric(18,2) not null check (reported_amount >= 0),
  marketing_spend numeric(18,2), list_marketing_amount numeric(18,2), list_total_amount numeric(18,2),
  has_details boolean not null, summary_range text not null, detail_range text,
  imported_at timestamptz not null default now(), source_hash text not null,
  primary key (organization_id, month)
);
create table public.contract_history_owners (
  organization_id uuid not null, month text not null, source_column integer not null,
  owner text not null, reported_count integer, reported_count_text text, reported_amount numeric(18,2),
  primary key (organization_id, month, source_column),
  foreign key (organization_id, month) references public.contract_history_months(organization_id, month) on delete restrict
);
create table public.contract_history_details (
  organization_id uuid not null, month text not null, source_cell text not null, source_range text not null,
  owner text not null, company text not null check(length(btrim(company))>0),
  channel text not null, grade text not null, program text not null,
  contract_amount numeric(18,2) check (contract_amount >= 0),
  customer_type text check (customer_type in ('신규','기존')), row_order integer not null,
  primary key (organization_id, month, source_cell),
  foreign key (organization_id, month) references public.contract_history_months(organization_id, month) on delete restrict
);
alter table public.contract_history_months enable row level security;
alter table public.contract_history_owners enable row level security;
alter table public.contract_history_details enable row level security;
-- Same server-only access model as the existing domain API; no new public data surface.
revoke all on public.contract_history_months, public.contract_history_owners, public.contract_history_details from public, anon, authenticated;
grant select, insert, update on public.contract_history_months, public.contract_history_owners, public.contract_history_details to service_role;
commit;
