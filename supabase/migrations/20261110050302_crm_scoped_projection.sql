-- Called only by the existing service-only atomic primary commit.
-- CRM promotion must not run the unrelated full-state financial projector.
create or replace function private.project_crm_delta(
  p_organization_id uuid, p_revision text, p_before jsonb, p_after jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $crm_delta$
declare
  old_by_id jsonb; new_by_id jsonb; old_lead jsonb; company jsonb;
  company_key text; account_key uuid; relation_key uuid; matches integer;
  changed integer := 0; created integer := 0;
  allowed text[] := array['createdAt','calendarOnly','crmSheet','channel',
    'premeetingAt','bookedAt','premeetingDoneAt','crmMeetings','crmMeeting',
    'history','status','projNo','salesOwner'];
begin
  if p_organization_id is null or nullif(p_revision,'') is null
    or jsonb_typeof(p_before->'leads') is distinct from 'array'
    or jsonb_typeof(p_after->'leads') is distinct from 'array' then
    raise exception 'crm_delta_invalid_input';
  end if;
  if p_before-array['leads','contractStatusLogs','revision']
    is distinct from p_after-array['leads','contractStatusLogs','revision'] then
    raise exception 'crm_delta_other_document_changed';
  end if;
  if not(coalesce(p_after->'contractStatusLogs','[]') @> coalesce(p_before->'contractStatusLogs','[]')) then
    raise exception 'crm_delta_log_lost';
  end if;
  select jsonb_object_agg(x->>'id',x) into old_by_id from jsonb_array_elements(p_before->'leads') x;
  select jsonb_object_agg(x->>'id',x) into new_by_id from jsonb_array_elements(p_after->'leads') x;
  if exists(select 1 from jsonb_array_elements(p_after->'leads') x where nullif(x->>'id','') is null)
    or (select count(*) from jsonb_object_keys(coalesce(new_by_id,'{}'))) <> jsonb_array_length(p_after->'leads')
    or exists(select 1 from jsonb_object_keys(coalesce(old_by_id,'{}')) k where not coalesce(new_by_id,'{}') ? k) then
    raise exception 'crm_delta_identity_or_delete';
  end if;
  for company in select x from jsonb_array_elements(p_after->'leads') x loop
    company_key := company->>'id'; old_lead := old_by_id->company_key;
    if old_lead is not distinct from company then continue; end if;
    if old_lead is not null then
      if old_lead-allowed is distinct from company-allowed
        or coalesce(old_lead->>'archivedAt',old_lead->>'archived_at',old_lead->>'deletedAt','') <> ''
        or (coalesce(old_lead->>'createdAt','')<>'' and old_lead->'createdAt' is distinct from company->'createdAt')
        or (coalesce(old_lead->>'projNo','')<>'' and old_lead->'projNo' is distinct from company->'projNo')
        or (old_lead->'status' is distinct from company->'status' and old_lead->>'status' not in ('신규 DB','TM 진행중','프리미팅 확정'))
        or (coalesce(old_lead->>'salesOwner','')<>'' and old_lead->'salesOwner' is distinct from company->'salesOwner')
        or (coalesce(old_lead->>'premeetingAt','')<>'' and old_lead->'premeetingAt' is distinct from company->'premeetingAt')
        or (coalesce(old_lead->>'bookedAt','')<>'' and old_lead->'bookedAt' is distinct from company->'bookedAt')
        or (coalesce(old_lead->>'premeetingDoneAt','')<>'' and old_lead->'premeetingDoneAt' is distinct from company->'premeetingDoneAt')
        or not(coalesce(company->'history','[]') @> coalesce(old_lead->'history','[]')) then
        raise exception 'crm_delta_protected_field_changed';
      end if;
    elsif coalesce((company->>'expected')::numeric,0)<>0
      or coalesce((company->>'contractAmount')::numeric,0)<>0
      or coalesce((company->>'paid')::numeric,0)<>0
      or coalesce(company->'payments','[]')<>'[]'::jsonb
      or coalesce(company->>'contractAt','')<>''
      or coalesce(company->>'archivedAt',company->>'archived_at',company->>'deletedAt','')<>''
      or coalesce(company->>'status','') not in ('신규 DB','프리미팅 확정','프리미팅 완료') then
      raise exception 'crm_delta_new_finance_forbidden';
    end if;
    select count(*),min(id::text)::uuid into matches,relation_key from public.leads
      where organization_id=p_organization_id and source_row_key='lead:'||company_key and archived_at is null;
    if matches>1 then raise exception 'crm_delta_relation_ambiguous'; end if;
    if old_lead is not null then
      if matches<>1 or not exists(select 1 from public.leads where id=relation_key and source_payload=old_lead) then
        raise exception 'crm_delta_snapshot_relation_mismatch';
      end if;
      -- Preserve account/source/external project identity and all financial relations.
      update public.leads set acquired_on=nullif(company->>'createdAt','')::date,
        channel=nullif(btrim(company->>'channel'),''),status_code=company->>'status',
        premeeting_scheduled_at=coalesce(nullif(company->>'premeetingAt','')::timestamptz,nullif(company->>'bookedAt','')::timestamptz),
        premeeting_completed_at=nullif(company->>'premeetingDoneAt','')::timestamptz,
        source_payload=company,projected_revision=p_revision,row_version=row_version+1,updated_at=now()
        where organization_id=p_organization_id and id=relation_key and archived_at is null;
    else
      if matches<>0 or exists(select 1 from public.leads where organization_id=p_organization_id and source_row_key='lead:'||company_key)
        or exists(select 1 from public.accounts where organization_id=p_organization_id and source_row_key='account:'||company_key and archived_at is not null) then
        raise exception 'crm_delta_existing_or_archived_identity';
      end if;
      select count(*),min(id::text)::uuid into matches,account_key from public.accounts
        where organization_id=p_organization_id and source_row_key='account:'||company_key and archived_at is null;
      if matches>1 then raise exception 'crm_delta_account_ambiguous'; end if;
      if matches=0 then
        insert into public.accounts(organization_id,name,normalized_name,external_crm_id,source,source_row_key,
          source_payload,field_owners,state,archived_at,projected_revision)
        values(p_organization_id,company->>'company',lower(company->>'company'),nullif(btrim(company->>'projNo'),''),
          case when nullif(btrim(company->>'projNo'),'') is null then 'GOOGLE_SHEETS'::public.kpi_source else 'CRM'::public.kpi_source end,
          'account:'||company_key,jsonb_build_object('projection','v3-state','leadKey',company_key),
          jsonb_build_object('name',case when nullif(btrim(company->>'projNo'),'') is null then 'USER' else 'CRM' end),
          'ACTIVE',null,p_revision) returning id into account_key;
      end if;
      insert into public.leads(organization_id,account_id,external_crm_id,source,source_row_key,acquired_on,channel,status_code,
        premeeting_scheduled_at,premeeting_completed_at,notes,source_payload,field_owners,state,archived_at,projected_revision)
      values(p_organization_id,account_key,nullif(btrim(company->>'projNo'),''),
        case when nullif(btrim(company->>'projNo'),'') is null then 'GOOGLE_SHEETS'::public.kpi_source else 'CRM'::public.kpi_source end,
        'lead:'||company_key,nullif(company->>'createdAt','')::date,nullif(btrim(company->>'channel'),''),company->>'status',
        coalesce(nullif(company->>'premeetingAt','')::timestamptz,nullif(company->>'bookedAt','')::timestamptz),
        nullif(company->>'premeetingDoneAt','')::timestamptz,nullif(btrim(company->>'memo'),''),company,
        jsonb_build_object('statusCode','USER','notes','USER','channel',case when nullif(btrim(company->>'projNo'),'') is null then 'USER' else 'CRM' end),
        'ACTIVE',null,p_revision);
      created:=created+1;
    end if;
    changed:=changed+1;
  end loop;
  -- Paginated employee reads require a coherent revision; do not stamp financial rows.
  update public.leads set projected_revision=p_revision
    where organization_id=p_organization_id and archived_at is null and projected_revision is distinct from p_revision;
  if exists(select 1 from jsonb_array_elements(p_after->'leads') x where not exists(
    select 1 from public.leads l where l.organization_id=p_organization_id and l.archived_at is null
      and l.source_payload=x and l.projected_revision=p_revision)) then
    raise exception 'crm_delta_post_projection_mismatch';
  end if;
  return jsonb_build_object('scope','crm-leads-only','changed',changed,'created',created,'financialProjection',false);
end;
$crm_delta$;
revoke all on function private.project_crm_delta(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch_commit$
declare definition text := pg_get_functiondef('public.commit_primary_mutation(uuid,text,text,text,text,jsonb)'::regprocedure);
  target text := 'v_projection := private.project_v3_state(p_organization_id,p_next_revision,v_next_state);';
begin
  if position('private.project_crm_delta(' in definition)>0 then return; end if;
  if position(target in definition)=0 then raise exception 'crm_delta_commit_template_drift'; end if;
  definition:=replace(definition,target,$replacement$
  if p_mutation->>'origin'='crm' and p_mutation->>'reason' in ('server-inflow-reconciliation','stored_premeeting_sync') then
    v_projection := private.project_crm_delta(p_organization_id,p_next_revision,v_current.state_snapshot,v_next_state);
  else
    v_projection := private.project_v3_state(p_organization_id,p_next_revision,v_next_state);
  end if;
  $replacement$);
  execute definition;
end;
$patch_commit$;
