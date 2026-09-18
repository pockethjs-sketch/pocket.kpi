begin;
drop function public.kpi_claim_employee_invitation(uuid,uuid);
create function public.kpi_claim_employee_invitation(p_organization_id uuid,p_user_id uuid,p_verified_email text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_email text := lower(btrim(p_verified_email)); v_role public.kpi_member_role;
begin
  -- Called only by service_role AFTER Auth.getUser confirmed the user and email.
  -- Do not grant SELECT on auth.users just to resolve an invoker permission error.
  if v_email is null or v_email='' then return false; end if;
  if exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id) then return false; end if;
  select role into v_role from public.employee_invitations where organization_id=p_organization_id and email=v_email and claimed_user_id is null for update;
  if v_role is null then return false; end if;
  insert into public.profiles(id,display_name,email) values(p_user_id,split_part(v_email,'@',1),v_email) on conflict(id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,role) values(p_organization_id,p_user_id,v_role) on conflict(organization_id,user_id) do nothing;
  update public.employee_invitations set claimed_user_id=p_user_id,claimed_at=now() where organization_id=p_organization_id and email=v_email and claimed_user_id is null;
  return true;
end;
$$;
revoke all on function public.kpi_claim_employee_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.kpi_claim_employee_invitation(uuid,uuid,text) to service_role;
commit;
