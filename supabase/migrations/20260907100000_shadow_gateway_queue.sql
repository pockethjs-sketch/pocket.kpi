begin;

insert into public.organizations(id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'pocket-kpi', 'Pocket KPI')
on conflict (slug) do nothing;

create table public.shadow_mutation_queue (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  mutation_id text not null,
  primary_revision text not null,
  mutation jsonb not null check (jsonb_typeof(mutation)='object'),
  state_snapshot jsonb check (state_snapshot is null or jsonb_typeof(state_snapshot)='object'),
  field_ownership_claims jsonb not null default '[]'::jsonb check (jsonb_typeof(field_ownership_claims)='array'),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','COMMITTED','FAILED')),
  attempts integer not null default 0 check (attempts >= 0), last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), committed_at timestamptz,
  unique (organization_id, mutation_id)
);

create table public.shadow_state_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  primary_revision text not null, state_snapshot jsonb not null check (jsonb_typeof(state_snapshot)='object'),
  source_mutation_id text not null, created_at timestamptz not null default now(),
  unique (organization_id, primary_revision), unique (organization_id, source_mutation_id)
);

create index shadow_queue_pending_idx on public.shadow_mutation_queue(organization_id, status, created_at) where status in ('PENDING','FAILED');
create index shadow_snapshots_latest_idx on public.shadow_state_snapshots(organization_id, created_at desc);

alter table public.shadow_mutation_queue enable row level security;
alter table public.shadow_mutation_queue force row level security;
alter table public.shadow_state_snapshots enable row level security;
alter table public.shadow_state_snapshots force row level security;
revoke all on public.shadow_mutation_queue, public.shadow_state_snapshots from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

comment on table public.shadow_mutation_queue is 'Server-only durable queue populated after Sheets V3 COMMIT. A failed Supabase attempt never changes the primary save result.';
comment on column public.shadow_mutation_queue.field_ownership_claims is 'USER mutation paths to resolve into entity_field_ownership while applying the queued mutation.';

commit;
