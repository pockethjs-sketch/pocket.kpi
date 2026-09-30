begin;
alter table public.organization_memberships add column access_scope text not null default 'all'
  check (access_scope in ('all','premeeting') and (access_scope='all' or role in ('EDITOR','VIEWER')));
alter table public.employee_invitations add column access_scope text not null default 'all'
  check (access_scope in ('all','premeeting') and (access_scope='all' or role in ('EDITOR','VIEWER')));

-- Invoker membership lookup must not recursively invoke itself through this policy.
-- Browser roles can inspect only their own membership; administration uses the authenticated Edge API.
alter policy memberships_member_select on public.organization_memberships
  using (user_id=(select auth.uid()));
create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.organization_memberships m
    where m.organization_id=target_org and m.user_id=(select auth.uid())
    and m.state='ACTIVE' and m.archived_at is null and m.access_scope='all');
$$;

create or replace function public.kpi_claim_employee_invitation(p_organization_id uuid,p_user_id uuid,p_verified_email text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_email text := lower(btrim(p_verified_email)); v_role public.kpi_member_role; v_scope text;
begin
  if v_email is null or v_email='' then return false; end if;
  if exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id) then return false; end if;
  select role,access_scope into v_role,v_scope from public.employee_invitations
    where organization_id=p_organization_id and email=v_email and claimed_user_id is null for update;
  if v_role is null then return false; end if;
  insert into public.profiles(id,display_name,email) values(p_user_id,split_part(v_email,'@',1),v_email) on conflict(id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,role,access_scope)
    values(p_organization_id,p_user_id,v_role,v_scope) on conflict(organization_id,user_id) do nothing;
  update public.employee_invitations set claimed_user_id=p_user_id,claimed_at=now()
    where organization_id=p_organization_id and email=v_email and claimed_user_id is null;
  return true;
end;
$$;
revoke all on function public.kpi_claim_employee_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.kpi_claim_employee_invitation(uuid,uuid,text) to service_role;
commit;
