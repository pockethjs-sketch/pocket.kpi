begin;
create table public.employee_invitations (
  organization_id uuid not null references public.organizations(id),
  email text not null check(email = lower(btrim(email)) and position('@' in email) > 1),
  role public.kpi_member_role not null check(role in ('OWNER','ADMIN','EDITOR','VIEWER')),
  approved_by uuid references auth.users(id),
  claimed_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key(organization_id,email)
);
alter table public.employee_invitations enable row level security;
revoke all on public.employee_invitations from public, anon, authenticated;
grant select, insert, update on public.employee_invitations to service_role;
create index employee_invitations_claimed_idx on public.employee_invitations(claimed_user_id) where claimed_user_id is not null;
create index employee_invitations_approver_idx on public.employee_invitations(approved_by) where approved_by is not null;

create function public.kpi_claim_employee_invitation(p_organization_id uuid,p_user_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_role public.kpi_member_role;
begin
  -- Only service_role may call this function, after auth.getUser validates the caller.
  if exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id) then return false; end if;
  select lower(email) into v_email from auth.users where id=p_user_id and email_confirmed_at is not null and coalesce(is_anonymous,false)=false;
  if v_email is null then return false; end if;
  select role into v_role from public.employee_invitations where organization_id=p_organization_id and email=v_email and claimed_user_id is null for update;
  if v_role is null then return false; end if;
  insert into public.profiles(id,display_name,email) values(p_user_id,split_part(v_email,'@',1),v_email) on conflict(id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,role) values(p_organization_id,p_user_id,v_role) on conflict(organization_id,user_id) do nothing;
  update public.employee_invitations set claimed_user_id=p_user_id,claimed_at=now() where organization_id=p_organization_id and email=v_email and claimed_user_id is null;
  return true;
end;
$$;
revoke all on function public.kpi_claim_employee_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.kpi_claim_employee_invitation(uuid,uuid) to service_role;
commit;
