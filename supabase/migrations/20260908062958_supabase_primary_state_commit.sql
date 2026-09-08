create or replace function public.commit_primary_state(
  p_organization_id uuid,
  p_mutation_id text,
  p_base_revision text,
  p_next_revision text,
  p_request_hash text,
  p_mutation jsonb,
  p_state_snapshot jsonb,
  p_field_ownership_claims jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.idempotency_keys%rowtype;
  v_current_revision text;
begin
  if p_organization_id is null or nullif(btrim(p_mutation_id), '') is null
     or nullif(btrim(p_next_revision), '') is null
     or jsonb_typeof(p_mutation) <> 'object'
     or jsonb_typeof(p_state_snapshot) <> 'object'
     or jsonb_typeof(p_field_ownership_claims) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_primary_commit');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));

  select * into v_existing
  from public.idempotency_keys
  where organization_id = p_organization_id and key = p_mutation_id;

  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    end if;
    return coalesce(v_existing.response, '{}'::jsonb) || jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select primary_revision into v_current_revision
  from public.shadow_state_snapshots
  where organization_id = p_organization_id
  order by created_at desc, id desc
  limit 1;

  if v_current_revision is distinct from p_base_revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflict', 'currentRevision', v_current_revision);
  end if;

  insert into public.idempotency_keys
    (organization_id, key, operation, request_hash, status)
  values
    (p_organization_id, p_mutation_id, 'SUPABASE_PRIMARY_V1', p_request_hash, 'PREPARE');

  insert into public.shadow_state_snapshots
    (organization_id, primary_revision, state_snapshot, source_mutation_id)
  values
    (p_organization_id, p_next_revision, p_state_snapshot, p_mutation_id);

  insert into public.shadow_mutation_queue
    (organization_id, mutation_id, primary_revision, mutation, state_snapshot,
     field_ownership_claims, status, attempts, committed_at)
  values
    (p_organization_id, p_mutation_id, p_next_revision, p_mutation, p_state_snapshot,
     p_field_ownership_claims, 'COMMITTED', 1, now());

  insert into public.audit_events
    (organization_id, entity_type, action_code, source, idempotency_key, metadata)
  values
    (p_organization_id, 'primary_state', 'COMMITTED', 'SYSTEM', p_mutation_id,
     jsonb_build_object('baseRevision', p_base_revision, 'nextRevision', p_next_revision));

  update public.idempotency_keys
  set status = 'COMMIT', updated_at = now(),
      response = jsonb_build_object('ok', true, 'revision', p_next_revision)
  where organization_id = p_organization_id and key = p_mutation_id;

  return jsonb_build_object('ok', true, 'revision', p_next_revision);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'commit_conflict');
end;
$$;

revoke all on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb)
  to service_role;

comment on function public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb) is
  'Atomic revision-gated primary state commit. Callable only by the server service role.';
