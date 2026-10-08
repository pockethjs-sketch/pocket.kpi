-- Supplemental server-enforced edit grant. Existing membership/RLS/claim unchanged.
create table public.employee_write_grants (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  profile text not null check (profile = 'premeeting_receivables'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index employee_write_grants_user_id_idx on public.employee_write_grants(user_id);
alter table public.employee_write_grants enable row level security;
revoke all on public.employee_write_grants from public, anon, authenticated, service_role;
grant select on public.employee_write_grants to service_role;
comment on table public.employee_write_grants is 'Server-only supplemental edit profiles; never grants EDITOR or direct business-table writes';
