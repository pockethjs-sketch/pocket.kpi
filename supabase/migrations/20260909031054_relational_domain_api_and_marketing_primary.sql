begin;

create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.app_documents (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_key text not null,
  document_value jsonb not null,
  projected_revision text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_key)
);

alter table public.app_documents enable row level security;
alter table public.app_documents force row level security;
revoke all on public.app_documents from public, anon, authenticated;
grant select, insert, update, delete on public.app_documents to service_role;

create or replace function private.kpi_patch_value(
  p_document jsonb,
  p_path jsonb,
  p_operation text,
  p_value jsonb default 'null'::jsonb
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := coalesce(p_document, '{}'::jsonb);
  v_path text[];
  v_parent text[] := array[]::text[];
  v_part text;
  v_current jsonb;
begin
  if jsonb_typeof(p_path) <> 'array' or jsonb_array_length(p_path) = 0 then
    raise exception 'invalid_patch_path';
  end if;
  select array_agg(value order by ordinality) into v_path
  from jsonb_array_elements_text(p_path) with ordinality as p(value, ordinality);
  if p_operation = 'delete' then
    return v_result #- v_path;
  end if;
  if p_operation <> 'set' then raise exception 'unsupported_patch_operation'; end if;

  if cardinality(v_path) > 1 then
    foreach v_part in array v_path[1:cardinality(v_path)-1] loop
      v_parent := array_append(v_parent, v_part);
      v_current := v_result #> v_parent;
      if v_current is null then
        v_result := jsonb_set(v_result, v_parent, '{}'::jsonb, true);
      end if;
    end loop;
  end if;
  return jsonb_set(v_result, v_path, coalesce(p_value, 'null'::jsonb), true);
end;
$$;

create or replace function private.kpi_apply_mutation(
  p_state jsonb,
  p_mutation jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_collection record;
  v_change jsonb;
  v_array jsonb;
  v_id_field text;
  v_item jsonb;
  v_patch jsonb;
  v_op jsonb;
  v_id text;
  v_index integer;
  v_allowed jsonb;
  v_doc record;
  v_key text;
begin
  if jsonb_typeof(v_state) <> 'object' or jsonb_typeof(p_mutation) <> 'object' then
    raise exception 'invalid_mutation_input';
  end if;

  for v_collection in select key, value from jsonb_each(coalesce(p_mutation->'collections', '{}'::jsonb)) loop
    v_change := v_collection.value;
    v_id_field := coalesce(nullif(v_change->>'idField', ''), 'id');
    v_array := case when jsonb_typeof(v_state->v_collection.key) = 'array'
      then v_state->v_collection.key else '[]'::jsonb end;

    for v_item in select value from jsonb_array_elements(coalesce(v_change->'upsert', '[]'::jsonb)) loop
      v_id := v_item->>v_id_field;
      select ordinality::integer - 1 into v_index
      from jsonb_array_elements(v_array) with ordinality as x(value, ordinality)
      where value->>v_id_field = v_id limit 1;
      if v_index is null then v_array := v_array || jsonb_build_array(v_item);
      else v_array := jsonb_set(v_array, array[v_index::text], v_item, false); end if;
      v_index := null;
    end loop;

    for v_patch in select value from jsonb_array_elements(coalesce(v_change->'patches', '[]'::jsonb)) loop
      v_id := v_patch->>'id';
      select ordinality::integer - 1 into v_index
      from jsonb_array_elements(v_array) with ordinality as x(value, ordinality)
      where value->>v_id_field = v_id limit 1;
      if v_index is not null then
        v_item := v_array->v_index;
        for v_op in select value from jsonb_array_elements(coalesce(v_patch->'ops', '[]'::jsonb)) loop
          v_item := private.kpi_patch_value(v_item, v_op->'path', v_op->>'op', v_op->'value');
        end loop;
        v_array := jsonb_set(v_array, array[v_index::text], v_item, false);
      end if;
      v_index := null;
    end loop;

    v_allowed := coalesce(p_mutation->'allowedRemovals'->v_collection.key, '[]'::jsonb);
    if jsonb_typeof(v_allowed) = 'array' and jsonb_array_length(v_allowed) > 0 then
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) into v_array
      from jsonb_array_elements(v_array) with ordinality as x(value, ordinality)
      where not exists (
        select 1 from jsonb_array_elements_text(v_allowed) a(id)
        where a.id = value->>v_id_field
      );
    end if;
    v_state := jsonb_set(v_state, array[v_collection.key], coalesce(v_array, '[]'::jsonb), true);
  end loop;

  for v_doc in select key, value from jsonb_each(coalesce(p_mutation->'documents', '{}'::jsonb)) loop
    v_state := jsonb_set(v_state, array[v_doc.key], v_doc.value, true);
  end loop;
  for v_key in select value from jsonb_array_elements_text(coalesce(p_mutation->'deleteDocuments', '[]'::jsonb)) loop
    v_state := v_state - v_key;
  end loop;
  return v_state;
end;
$$;

create or replace function private.project_app_documents(
  p_organization_id uuid,
  p_revision text,
  p_state jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.app_documents
    (organization_id, document_key, document_value, projected_revision, updated_at)
  select p_organization_id, key, value, p_revision, now()
  from jsonb_each(p_state)
  where key not in ('leads', 'adDaily', 'adSpend', 'adSpendMeta')
  on conflict (organization_id, document_key) do update set
    document_value=excluded.document_value,
    projected_revision=excluded.projected_revision,
    updated_at=excluded.updated_at;

  delete from public.app_documents
  where organization_id=p_organization_id
    and projected_revision is distinct from p_revision;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.prefer_direct_marketing(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.marketing_daily_spend projected
  set archived_at=coalesce(projected.archived_at, now()), updated_at=now()
  where projected.organization_id=p_organization_id
    and projected.payload->>'projection'='v3-state'
    and projected.archived_at is null
    and exists (
      select 1 from public.marketing_daily_spend direct
      where direct.organization_id=projected.organization_id
        and direct.spend_date=projected.spend_date
        and direct.provider=projected.provider
        and direct.channel_code=projected.channel_code
        and direct.archived_at is null
        and direct.payload->>'collector'='supabase-edge'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $patch$
declare v_definition text; v_changed text;
begin
  v_definition := pg_get_functiondef('private.project_v3_state(uuid,text,jsonb)'::regprocedure);
  v_changed := replace(v_definition,
    $needle$jsonb_build_object('projection', 'v3-state', 'leadKey', s.lead_key),$needle$,
    $replacement$s.lead,$replacement$);
  v_changed := replace(v_changed,
    $needle$jsonb_build_object('projection', 'v3-state', 'leadKey', d.lead_key),$needle$,
    $replacement$d.lead,$replacement$);
  v_changed := replace(v_changed,
    $needle$where organization_id = p_organization_id and projected_revision is distinct from p_revision;

  with activity_rows as ($needle$,
    $replacement$where organization_id = p_organization_id
    and projected_revision is distinct from p_revision
    and coalesce(payload->>'projection', '') = 'v3-state';

  perform private.prefer_direct_marketing(p_organization_id);

  with activity_rows as ($replacement$);
  if v_changed = v_definition then raise exception 'project_v3_state_patch_not_applied'; end if;
  execute v_changed;
end;
$patch$;

create or replace function public.commit_primary_mutation(
  p_organization_id uuid,
  p_mutation_id text,
  p_base_revision text,
  p_next_revision text,
  p_request_hash text,
  p_mutation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.idempotency_keys%rowtype;
  v_current public.app_current_state%rowtype;
  v_next_state jsonb;
  v_projection jsonb;
begin
  if p_organization_id is null or nullif(btrim(p_mutation_id), '') is null
    or nullif(btrim(p_next_revision), '') is null or jsonb_typeof(p_mutation) <> 'object' then
    return jsonb_build_object('ok',false,'error','invalid_mutation_commit');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));
  select * into v_existing from public.idempotency_keys
  where organization_id=p_organization_id and key=p_mutation_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok',false,'error','idempotency_conflict');
    end if;
    return coalesce(v_existing.response,'{}'::jsonb) || jsonb_build_object('ok',true,'duplicate',true);
  end if;
  select * into v_current from public.app_current_state
  where organization_id=p_organization_id for update;
  if not found then return jsonb_build_object('ok',false,'error','state_missing'); end if;
  if v_current.primary_revision is distinct from p_base_revision then
    return jsonb_build_object('ok',false,'error','revision_conflict','currentRevision',v_current.primary_revision);
  end if;

  v_next_state := private.kpi_apply_mutation(v_current.state_snapshot, p_mutation);
  insert into public.idempotency_keys(organization_id,key,operation,request_hash,status)
  values(p_organization_id,p_mutation_id,'SUPABASE_DOMAIN_MUTATION',p_request_hash,'PREPARE');
  update public.app_current_state set primary_revision=p_next_revision,
    state_snapshot=v_next_state, source_mutation_id=p_mutation_id, updated_at=now()
  where organization_id=p_organization_id;
  insert into public.app_state_daily_checkpoints
    (organization_id,checkpoint_date,primary_revision,state_snapshot,source_mutation_id)
  values(p_organization_id,(now() at time zone 'Asia/Seoul')::date,p_next_revision,v_next_state,p_mutation_id)
  on conflict (organization_id,checkpoint_date) do nothing;

  v_projection := private.project_v3_state(p_organization_id,p_next_revision,v_next_state);
  perform private.project_app_documents(p_organization_id,p_next_revision,v_next_state);
  perform private.prefer_direct_marketing(p_organization_id);

  insert into public.shadow_mutation_queue
    (organization_id,mutation_id,primary_revision,mutation,state_snapshot,
     field_ownership_claims,status,attempts,committed_at)
  values(p_organization_id,p_mutation_id,p_next_revision,p_mutation,null,
    '[]'::jsonb,'COMMITTED',1,now());
  insert into public.audit_events
    (organization_id,entity_type,action_code,source,idempotency_key,metadata)
  values(p_organization_id,'domain_mutation','COMMITTED','SYSTEM',p_mutation_id,
    jsonb_build_object('baseRevision',p_base_revision,'nextRevision',p_next_revision));
  update public.idempotency_keys set status='COMMIT',updated_at=now(),
    response=jsonb_build_object('ok',true,'revision',p_next_revision,'relationsProjected',true)
  where organization_id=p_organization_id and key=p_mutation_id;
  return jsonb_build_object('ok',true,'revision',p_next_revision,
    'relationsProjected',true,'projection',v_projection);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','commit_conflict');
end;
$$;

create or replace function public.kpi_finalize_marketing_sync(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_archived integer; v_count bigint; v_total numeric;
begin
  v_archived := private.prefer_direct_marketing(p_organization_id);
  select count(*),coalesce(sum(spend_amount),0) into v_count,v_total
  from public.marketing_daily_spend
  where organization_id=p_organization_id and archived_at is null;
  return jsonb_build_object('ok',true,'archivedProjectionRows',v_archived,
    'activeRows',v_count,'totalSpend',v_total);
end;
$$;

create or replace function public.kpi_store_marketing_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_allowed text[] := array[
  'MK_META_ACCESS_TOKEN','MK_META_AD_ACCOUNT_ID','MK_META_GRAPH_VERSION',
  'MK_META_TRAFFIC_PATTERN','MK_META_BUILDER_PATTERN','MK_META_LEAD_PATTERN',
  'MK_NAVER_API_KEY','MK_NAVER_SECRET_KEY','MK_NAVER_CUSTOMER_ID',
  'MK_GOOGLE_CLIENT_ID','MK_GOOGLE_CLIENT_SECRET','MK_GOOGLE_REFRESH_TOKEN',
  'MK_GOOGLE_DEVELOPER_TOKEN','MK_GOOGLE_CUSTOMER_ID','MK_GOOGLE_LOGIN_CUSTOMER_ID',
  'MK_GOOGLE_API_VERSION','MK_BACKFILL_DAYS'
]; v_key text; v_value text; v_id uuid;
begin
  if jsonb_typeof(p_config) <> 'object' then raise exception 'invalid_marketing_config'; end if;
  for v_key,v_value in select key,value #>> '{}' from jsonb_each(p_config) loop
    if not (v_key = any(v_allowed)) or nullif(btrim(v_value),'') is null then continue; end if;
    select id into v_id from vault.secrets where name='kpi_marketing_'||lower(v_key) limit 1;
    if v_id is null then perform vault.create_secret(v_value,'kpi_marketing_'||lower(v_key),'Pocket KPI marketing provider configuration');
    else perform vault.update_secret(v_id,v_value,'kpi_marketing_'||lower(v_key),'Pocket KPI marketing provider configuration'); end if;
  end loop;
  return jsonb_build_object('ok',true,'savedKeys',
    (select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
     from jsonb_object_keys(p_config) as keys(key) where key=any(v_allowed)));
end;
$$;

create or replace function public.kpi_read_marketing_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(upper(substr(name,15)),decrypted_secret),'{}'::jsonb)
  from vault.decrypted_secrets where name like 'kpi_marketing_mk\_%' escape '\';
$$;

create or replace function public.kpi_configure_marketing_schedule(
  p_function_url text,
  p_cron_secret text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_job bigint;
begin
  if p_function_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/kpi-marketing-sync$'
    or length(coalesce(p_cron_secret,'')) < 32 then raise exception 'invalid_schedule_config'; end if;
  select id into v_id from vault.secrets where name='kpi_marketing_function_url' limit 1;
  if v_id is null then perform vault.create_secret(p_function_url,'kpi_marketing_function_url','Pocket KPI marketing Edge URL');
  else perform vault.update_secret(v_id,p_function_url,'kpi_marketing_function_url','Pocket KPI marketing Edge URL'); end if;
  v_id := null;
  select id into v_id from vault.secrets where name='kpi_marketing_cron_secret' limit 1;
  if v_id is null then perform vault.create_secret(p_cron_secret,'kpi_marketing_cron_secret','Pocket KPI marketing cron auth');
  else perform vault.update_secret(v_id,p_cron_secret,'kpi_marketing_cron_secret','Pocket KPI marketing cron auth'); end if;
  for v_job in select jobid from cron.job where jobname='pocket-kpi-marketing-sync' loop perform cron.unschedule(v_job); end loop;
  v_job := cron.schedule('pocket-kpi-marketing-sync','0 */6 * * *',$job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_function_url' limit 1),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-kpi-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_cron_secret' limit 1)
      ),
      body := jsonb_build_object('action','sync')
    );
  $job$);
  return jsonb_build_object('ok',true,'jobId',v_job,'schedule','every_6_hours');
end;
$$;

do $commitpatch$
declare v_definition text; v_changed text;
begin
  v_definition := pg_get_functiondef('public.commit_primary_state(uuid,text,text,text,text,jsonb,jsonb,jsonb)'::regprocedure);
  v_changed := replace(v_definition,
    $needle$v_projection := private.project_v3_state(p_organization_id, p_next_revision, p_state_snapshot);$needle$,
    $replacement$v_projection := private.project_v3_state(p_organization_id, p_next_revision, p_state_snapshot);
  perform private.project_app_documents(p_organization_id, p_next_revision, p_state_snapshot);
  perform private.prefer_direct_marketing(p_organization_id);$replacement$);
  if v_changed = v_definition then raise exception 'commit_primary_state_patch_not_applied'; end if;
  execute v_changed;
end;
$commitpatch$;

revoke all on function private.kpi_patch_value(jsonb,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function private.kpi_apply_mutation(jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.project_app_documents(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.prefer_direct_marketing(uuid) from public,anon,authenticated;
revoke all on function public.commit_primary_mutation(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.kpi_finalize_marketing_sync(uuid) from public,anon,authenticated;
revoke all on function public.kpi_store_marketing_config(jsonb) from public,anon,authenticated;
revoke all on function public.kpi_read_marketing_config() from public,anon,authenticated;
revoke all on function public.kpi_configure_marketing_schedule(text,text) from public,anon,authenticated;
grant execute on function public.commit_primary_mutation(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.kpi_finalize_marketing_sync(uuid) to service_role;
grant execute on function public.kpi_store_marketing_config(jsonb) to service_role;
grant execute on function public.kpi_read_marketing_config() to service_role;
grant execute on function public.kpi_configure_marketing_schedule(text,text) to service_role;

select private.project_app_documents(organization_id,primary_revision,state_snapshot)
from public.app_current_state;
select private.project_v3_state(organization_id,primary_revision,state_snapshot)
from public.app_current_state;
select private.prefer_direct_marketing(organization_id) from public.app_current_state;

comment on table public.app_documents is 'Small top-level application documents split from the compatibility snapshot for domain reads.';
comment on function public.commit_primary_mutation(uuid,text,text,text,text,jsonb) is 'Patch-only atomic commit. The server applies the mutation and retains a compatibility checkpoint.';
comment on function public.kpi_store_marketing_config(jsonb) is 'Service-role-only migration of provider credentials into Supabase Vault.';

commit;
