begin;

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef('private.project_v3_state(uuid,text,jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    '''contractEvents'', (select count(*) from public.contract_events where organization_id=p_organization_id and archived_at is null)',
    '''contractEvents'', (select count(distinct coalesce(source_hash, id::text)) from public.contract_events where organization_id=p_organization_id and archived_at is null)'
  );
  execute v_definition;
end;
$$;

update public.app_state_projections p
set entity_counts = jsonb_set(
  p.entity_counts,
  '{contractEvents}',
  to_jsonb((select count(distinct coalesce(e.source_hash, e.id::text))
            from public.contract_events e
            where e.organization_id = p.organization_id and e.archived_at is null)),
  true
);

commit;
