-- Upcoming CRM premeetings for the buildup workspace overview, today onward (part 1: storage).
-- Server-only tables; no browser grants. No phone, e-mail or address columns.
create table if not exists public.buildup_premeetings (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  schedule_no text not null,
  meeting_at timestamptz not null,
  meeting_end_at timestamptz,
  meeting_day date not null,
  meeting_way text not null default '',
  company text not null,
  contact text not null default '',
  sales_owner text not null default '',
  managers text[] not null default '{}',
  booked_by text not null default '',
  crm_project_no text,
  crm_client_no text,
  visited boolean not null default false,
  client jsonb not null default '{}'::jsonb,
  note text not null default '',
  source_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint buildup_premeetings_pkey primary key (organization_id, schedule_no),
  constraint buildup_premeetings_schedule_format check (schedule_no ~ '^[0-9]{1,20}$'),
  constraint buildup_premeetings_numbers check (
    (crm_project_no is null or crm_project_no ~ '^[0-9]{1,20}$') and (crm_client_no is null or crm_client_no ~ '^[0-9]{1,20}$')),
  constraint buildup_premeetings_text_sizes check (
    char_length(company) between 1 and 200 and char_length(contact) <= 100 and char_length(sales_owner) <= 100
    and char_length(booked_by) <= 100 and char_length(meeting_way) <= 20 and char_length(note) <= 1000
    and cardinality(managers) <= 10),
  constraint buildup_premeetings_end_after_start check (meeting_end_at is null or meeting_end_at >= meeting_at),
  constraint buildup_premeetings_client_object check (jsonb_typeof(client) = 'object' and pg_column_size(client) <= 8000)
);

create index if not exists buildup_premeetings_upcoming
  on public.buildup_premeetings (organization_id, meeting_day) where removed_at is null;

create table if not exists public.buildup_premeeting_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  trigger text not null check (trigger in ('cron', 'manual')),
  window_start date not null,
  window_end date not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  fetched integer check (fetched is null or fetched >= 0),
  stored integer check (stored is null or stored >= 0),
  removed integer check (removed is null or removed >= 0),
  skipped integer check (skipped is null or skipped >= 0),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint buildup_premeeting_runs_window check (window_start <= window_end)
);

create index if not exists buildup_premeeting_runs_recent
  on public.buildup_premeeting_runs (organization_id, started_at desc);

alter table public.buildup_premeetings enable row level security;
alter table public.buildup_premeetings force row level security;
alter table public.buildup_premeeting_runs enable row level security;
alter table public.buildup_premeeting_runs force row level security;

grant select, insert, update, delete on public.buildup_premeetings to service_role;
grant select, insert, update on public.buildup_premeeting_runs to service_role;
grant usage, select on sequence public.buildup_premeeting_runs_id_seq to service_role;

comment on table public.buildup_premeetings is
  'Upcoming CRM premeetings (today..+30 days) for the buildup workspace overview. Server-only; refreshed 08:00 KST by kpi-buildup-premeetings. No phone, e-mail or address. removed_at marks schedules that left the CRM window (cancelled or moved).';
comment on table public.buildup_premeeting_runs is
  'Refresh runs of the upcoming premeeting list: window, counts and short error codes only.';
