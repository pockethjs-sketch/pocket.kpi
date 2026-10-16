-- Avoid re-writing the large unchanged lead/deal payloads on every small patch.
-- Keep complete snapshot projection, atomicity, archive behavior and revision parity.
-- No timeout, permission, RLS or financial calculation changes.
do $patch$
declare
  definition text := pg_get_functiondef('private.project_v3_state(uuid,text,jsonb)'::regprocedure);
  old_block text;
  new_block text;
  table_name text;
  columns text;
  left_columns text;
  right_columns text;
  start_at integer;
  end_at integer;
begin
  foreach table_name in array array['leads','deals'] loop
    if position('where (public.'||table_name||'.source_payload' in definition)>0 then continue; end if;
    start_at := strpos(definition, '  insert into public.'||table_name||chr(10));
    end_at := strpos(substr(definition,start_at),chr(10)||chr(10)||'  update public.'||table_name||' set')+start_at-1;
    if start_at=0 or end_at<=start_at then raise exception 'projection_patch_target_missing'; end if;
    old_block := substr(definition,start_at,end_at-start_at);
    columns := case table_name when 'leads' then
      'source_payload,account_id,external_crm_id,acquired_on,channel,status_code,premeeting_scheduled_at,premeeting_completed_at,notes,field_owners,state,archived_at'
      else 'source_payload,account_id,lead_id,external_crm_id,service_code,stage_code,quoted_amount,contract_amount,contracted_on,field_owners,state,archived_at' end;
    select string_agg('public.'||table_name||'.'||c,',' order by ord),
      string_agg('excluded.'||c,',' order by ord)
    into left_columns,right_columns
    from unnest(string_to_array(columns,',')) with ordinality t(c,ord);
    new_block := left(old_block,length(old_block)-1)||chr(10)||
      '  where ('||left_columns||') is distinct from ('||right_columns||');'||chr(10)||chr(10)||
      '  update public.'||table_name||' set projected_revision = p_revision'||chr(10)||
      '  where organization_id = p_organization_id and archived_at is null'||chr(10)||
      '    and projected_revision is distinct from p_revision'||chr(10)||
      '    and source_payload in (select value from jsonb_array_elements(p_state->''leads''));';
    definition := overlay(definition placing new_block from start_at for end_at-start_at);
  end loop;
  execute definition;
end;
$patch$;
