-- Bulk CRM patches use one array assembly instead of cloning all companies per change.
create or replace function private.kpi_apply_crm_ops(p_item jsonb,p_ops jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $ops$
declare result jsonb:=p_item; op jsonb;
begin
  for op in select value from jsonb_array_elements(coalesce(p_ops,'[]')) loop
    result:=private.kpi_patch_value(result,op->'path',op->>'op',op->'value');
  end loop;
  return result;
end;
$ops$;
revoke all on function private.kpi_apply_crm_ops(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function private.kpi_apply_crm_mutation(p_state jsonb,p_mutation jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $batch$
declare result jsonb:=p_state; col record; original jsonb; upserts jsonb; patches jsonb;
  original_ids jsonb; upsert_map jsonb; patch_map jsonb; assembled jsonb;
begin
  if p_mutation->>'origin' is distinct from 'crm'
    or coalesce(p_mutation->>'reason','') not in ('server-inflow-reconciliation','stored_premeeting_sync')
    or exists(select 1 from jsonb_object_keys(p_mutation) k where k not in ('origin','reason','collections'))
    or jsonb_typeof(p_mutation->'collections') is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_mutation->'collections') k where k not in ('leads','contractStatusLogs')) then
    raise exception 'crm_batch_scope_invalid';
  end if;
  for col in select key,value from jsonb_each(p_mutation->'collections') loop
    if coalesce(col.value->>'idField','id')<>'id'
      or exists(select 1 from jsonb_object_keys(col.value) k where k not in ('idField','upsert','patches')) then
      raise exception 'crm_batch_collection_invalid';
    end if;
    original:=coalesce(result->col.key,'[]'); upserts:=coalesce(col.value->'upsert','[]'); patches:=coalesce(col.value->'patches','[]');
    if exists(select 1 from jsonb_array_elements(original||upserts||patches) x where nullif(x->>'id','') is null) then
      raise exception 'crm_batch_id_missing'; end if;
    select coalesce(jsonb_object_agg(x->>'id',true),'{}') into original_ids from jsonb_array_elements(original) x;
    select coalesce(jsonb_object_agg(x->>'id',x),'{}') into upsert_map from jsonb_array_elements(upserts) x;
    select coalesce(jsonb_object_agg(x->>'id',x->'ops'),'{}') into patch_map from jsonb_array_elements(patches) x;
    if (select count(*) from jsonb_object_keys(original_ids))<>jsonb_array_length(original)
      or (select count(*) from jsonb_object_keys(upsert_map))<>jsonb_array_length(upserts)
      or (select count(*) from jsonb_object_keys(patch_map))<>jsonb_array_length(patches) then
      raise exception 'crm_batch_duplicate_id'; end if;
    select coalesce(jsonb_agg(private.kpi_apply_crm_ops(value,patch_map->(value->>'id')) order by position),'[]') into assembled
    from (
      select coalesce(upsert_map->(x->>'id'),x) value,ord position from jsonb_array_elements(original) with ordinality t(x,ord)
      union all
      select x,jsonb_array_length(original)+ord from jsonb_array_elements(upserts) with ordinality t(x,ord)
        where not original_ids ? (x->>'id')
    ) rows;
    result:=jsonb_set(result,array[col.key],assembled,true);
  end loop;
  return result;
end;
$batch$;
revoke all on function private.kpi_apply_crm_mutation(jsonb,jsonb) from public,anon,authenticated,service_role;

do $route$
declare definition text:=pg_get_functiondef('public.commit_primary_mutation(uuid,text,text,text,text,jsonb)'::regprocedure);
  target text:='v_next_state := private.kpi_apply_mutation(v_current.state_snapshot, p_mutation);';
begin
  if position('private.kpi_apply_crm_mutation(' in definition)>0 then return; end if;
  if position(target in definition)=0 then raise exception 'crm_batch_commit_template_drift'; end if;
  execute replace(definition,target,$replacement$
  if p_mutation->>'origin'='crm' and p_mutation->>'reason' in ('server-inflow-reconciliation','stored_premeeting_sync') then
    v_next_state := private.kpi_apply_crm_mutation(v_current.state_snapshot,p_mutation);
  else
    v_next_state := private.kpi_apply_mutation(v_current.state_snapshot,p_mutation);
  end if;
  $replacement$);
end;
$route$;
