-- Preserve the exact matching rules; index company identities once per reconciliation.
do $keyed$
declare definition text:=pg_get_functiondef('public.kpi_reconcile_crm_inflow(uuid,date,date,boolean)'::regprocedure);
  target text;
begin
  if position('v_identity_index jsonb' in definition)>0 then return; end if;
  definition:=replace(definition,'  v_leads jsonb;',E'  v_leads jsonb;\n  v_identity_index jsonb; identity_key text;');
  target:='  -- Select one inquiry per client, not per project; earliest acquisition day is stable.';
  if position(target in definition)=0 then raise exception 'crm_keyed_plan_template_drift'; end if;
  definition:=replace(definition,target,$build$
  select coalesce(jsonb_object_agg(k,items),'{}') into v_identity_index from (
    select k,jsonb_agg(l) items from jsonb_array_elements(v_leads) l
    cross join lateral (values ('id:'||(l->>'id')),('client:'||(l#>>'{crmSheet,clientNo}')),('project:'||(l->>'projNo'))) keys(k)
    where k is not null and k not in ('id:','client:','project:') group by k
  ) indexed;
  -- Select one inquiry per client, not per project; earliest acquisition day is stable.
  $build$);
  target:=$old$    select coalesce(jsonb_agg(l), '[]') into v_matches from jsonb_array_elements(v_leads) l
    where l->>'id'=v_id or l#>>'{crmSheet,clientNo}'=v_raw->>'client_no'
      or (v_project is not null and l->>'projNo'=v_project);$old$;
  if position(target in definition)=0 then raise exception 'crm_keyed_match_template_drift'; end if;
  definition:=replace(definition,target,$new$
    select coalesce(jsonb_agg(l),'[]') into v_matches from (
      select distinct on(l->>'id') l from jsonb_array_elements(
        coalesce(v_identity_index->('id:'||v_id),'[]') ||
        coalesce(v_identity_index->('client:'||(v_raw->>'client_no')),'[]') ||
        coalesce(v_identity_index->('project:'||v_project),'[]')) l
    ) candidates;
  $new$);
  target:='      v_leads := v_leads||jsonb_build_array(v_new);';
  if position(target in definition)=0 then raise exception 'crm_keyed_append_template_drift'; end if;
  definition:=replace(definition,target,$append$
      foreach identity_key in array array['id:'||v_id,'client:'||(v_raw->>'client_no'),'project:'||v_project] loop
        if identity_key is not null then
          v_identity_index:=jsonb_set(v_identity_index,array[identity_key],coalesce(v_identity_index->identity_key,'[]')||jsonb_build_array(v_new),true);
        end if;
      end loop;
  $append$);
  definition:=replace(definition,'l.source_payload->>''id''=v_old->>''id''','l.source_row_key=''lead:''||(v_old->>''id'')');
  definition:=replace(definition,'p.source_payload->>''id''=l->>''id''','p.source_row_key=''lead:''||(l->>''id'')');
  execute definition;
end;
$keyed$;
