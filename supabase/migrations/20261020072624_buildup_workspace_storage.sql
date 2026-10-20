-- Sales buildup consultation workspace: per-employee consultation storage and company AI usage ledger.
-- Server-only tables. Browser roles receive no grants; the kpi-buildup-api Edge Function validates a
-- verified employee session and current ACTIVE organization membership before every read or write.
-- Each employee writes only their own rows; OWNER/ADMIN read access is enforced in the function.

create table if not exists public.buildup_projects (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  project_id text not null,
  summary jsonb not null default '{}'::jsonb,
  core jsonb not null,
  heavy jsonb,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint buildup_projects_pkey primary key (organization_id, owner_user_id, project_id),
  constraint buildup_projects_project_id_format check (project_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint buildup_projects_revision_positive check (revision > 0),
  constraint buildup_projects_summary_object check (jsonb_typeof(summary) = 'object'),
  constraint buildup_projects_core_object check (jsonb_typeof(core) = 'object'),
  constraint buildup_projects_heavy_object check (heavy is null or jsonb_typeof(heavy) = 'object')
);

create index if not exists buildup_projects_org_recent
  on public.buildup_projects (organization_id, updated_at desc) where deleted_at is null;

create table if not exists public.buildup_ai_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  model text not null check (char_length(model) between 1 and 80),
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists buildup_ai_usage_user_recent
  on public.buildup_ai_usage (organization_id, user_id, created_at desc);
create index if not exists buildup_ai_usage_org_recent
  on public.buildup_ai_usage (organization_id, created_at desc);

alter table public.buildup_projects enable row level security;
alter table public.buildup_projects force row level security;
alter table public.buildup_ai_usage enable row level security;
alter table public.buildup_ai_usage force row level security;

revoke all on public.buildup_projects, public.buildup_ai_usage from anon, authenticated;
revoke all on sequence public.buildup_ai_usage_id_seq from anon, authenticated;
grant select, insert, update on public.buildup_projects, public.buildup_ai_usage to service_role;
grant usage, select on sequence public.buildup_ai_usage_id_seq to service_role;

comment on table public.buildup_projects is
  'Sales buildup consultations, one row per employee project. Server-only: kpi-buildup-api validates employee session and membership; owners write their own rows, OWNER/ADMIN read all. Soft delete via deleted_at.';
comment on table public.buildup_ai_usage is
  'Company AI key usage ledger for the buildup workspace (per-employee hourly limit and admin overview). Server-only; holds model and token counts, never prompts.';
