begin;

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef('private.project_v3_state(uuid,text,jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    'coalesce(event->>''id'', event->>''sourceKey'')',
    'coalesce(event->>''sourceKey'', event->>''id'')'
  );
  execute v_definition;
end;
$$;

create or replace view public.contract_events_effective
with (security_invoker = true) as
select distinct on (organization_id, coalesce(source_hash, id::text)) *
from public.contract_events
where archived_at is null
order by organization_id, coalesce(source_hash, id::text), created_at asc, id asc;

revoke all on public.contract_events_effective from anon;
grant select on public.contract_events_effective to authenticated;

commit;
