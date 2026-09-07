begin;

create or replace function private.source_may_write_field(
  target_org uuid, target_entity_type text, target_entity_id uuid, target_field text, incoming_source public.kpi_source
) returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((
    select case
      when o.owner_source='USER' and incoming_source <> 'USER' then false
      when incoming_source='SYSTEM' and o.owner_source <> 'SYSTEM' then false
      else o.owner_source=incoming_source or incoming_source='USER'
    end
    from public.entity_field_ownership o
    where o.organization_id=target_org and o.entity_type=target_entity_type and o.entity_id=target_entity_id and o.field_name=target_field
  ), true);
$$;

create or replace function private.restore_archived_record(target_table regclass, target_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if target_table not in ('public.accounts'::regclass, 'public.leads'::regclass, 'public.deals'::regclass,
                          'public.payment_plans'::regclass, 'public.payment_receipts'::regclass,
                          'public.marketing_daily_spend'::regclass) then
    raise exception 'restore_not_allowed';
  end if;
  execute format('update %s set archived_at=null where id=$1', target_table) using target_id;
end;
$$;

revoke all on function private.source_may_write_field(uuid,text,uuid,text,public.kpi_source) from public, anon, authenticated;
revoke all on function private.restore_archived_record(regclass,uuid) from public, anon, authenticated;

commit;
