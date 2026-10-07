-- Applied migration version from the production migration ledger: 20261007013617.
-- Raw collection is not success until the operational state and relational projection agree.
-- No browser grants, no SECURITY DEFINER, no finance/status/memo updates on existing leads.
alter table public.crm_sync_runs
  add column if not exists inflow_result jsonb,
  add column if not exists inflow_completed_at timestamptz;

create or replace function public.kpi_reconcile_crm_inflow(
  p_organization_id uuid,
  p_start date,
  p_end date,
  p_dry_run boolean default true
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_current public.app_current_state%rowtype;
  r record;
  v_leads jsonb;
  v_matches jsonb;
  v_old jsonb;
  v_new jsonb;
  v_sheet jsonb;
  v_raw jsonb;
  v_upserts jsonb := '[]';
  v_patches jsonb := '[]';
  v_logs jsonb := '[]';
  v_ops jsonb;
  v_field text;
  v_id text;
  v_project text;
  v_channel text;
  v_inflow jsonb;
  v_first text;
  v_buildup text;
  v_phone text;
  v_detail text;
  v_day text;
  v_total integer := 0;
  v_added integer := 0;
  v_enriched integer := 0;
  v_existing integer := 0;
  v_deleted integer := 0;
  v_blocked integer := 0;
  v_result jsonb;
  v_mutation jsonb;
  v_commit jsonb;
  v_revision text;
  v_key text;
  v_now text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_organization_id is null or p_start is null or p_end is null or p_start > p_end
    or p_end > (now() at time zone 'Asia/Seoul')::date or p_dry_run is null then
    raise exception 'invalid_inflow_range';
  end if;
  -- Same lock as all primary writers: plan and commit against one revision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));
  select * into v_current from public.app_current_state where organization_id=p_organization_id for update;
  if not found then raise exception 'inflow_state_missing'; end if;
  v_leads := coalesce(v_current.state_snapshot->'leads', '[]'::jsonb);
  if jsonb_typeof(v_leads) <> 'array' then raise exception 'inflow_state_invalid'; end if;

  -- Select one inquiry per client, not per project; earliest acquisition day is stable.
  -- Last version of that inquiry wins. Missing identities are counted, never guessed.
  for r in
    select distinct on (coalesce(nullif(payload->>'client_no',''), 'missing:'||external_id))
      payload, source_date, external_id
    from public.crm_raw_records
    where organization_id=p_organization_id and record_type='LEAD' and source_date between p_start and p_end
    order by coalesce(nullif(payload->>'client_no',''), 'missing:'||external_id), source_date,
      last_seen_at desc, id desc
  loop
    v_total := v_total + 1;
    v_raw := r.payload;
    if coalesce(v_raw->>'client_no','') !~ '^[0-9]+$' then
      v_blocked := v_blocked + 1; continue;
    end if;
    v_id := 'crm-'||(v_raw->>'client_no');
    v_project := nullif(v_raw->>'proj_no','');
    v_day := r.source_date::text;
    select coalesce(jsonb_agg(l), '[]') into v_matches from jsonb_array_elements(v_leads) l
    where l->>'id'=v_id or l#>>'{crmSheet,clientNo}'=v_raw->>'client_no'
      or (v_project is not null and l->>'projNo'=v_project);
    if jsonb_array_length(v_matches)>1 then v_blocked := v_blocked+1; continue; end if;
    v_old := v_matches->0;
    if coalesce(v_old->>'archivedAt',v_old->>'archived_at',v_old->>'deletedAt','') <> '' then
      v_deleted := v_deleted+1; continue;
    end if;
    -- Archived relational rows are tombstones for user-deleted records.
    if v_old is null and exists(select 1 from public.leads l where l.organization_id=p_organization_id
      and l.archived_at is not null and (l.source_payload->>'id'=v_id
        or l.source_payload#>>'{crmSheet,clientNo}'=v_raw->>'client_no'
        or (v_project is not null and l.external_crm_id=v_project))) then
      v_deleted := v_deleted+1; continue;
    end if;
    -- Already acquired: leave all user edits and the original cohort untouched.
    if nullif(v_old->>'createdAt','') is not null then
      if not exists(select 1 from public.leads l where l.organization_id=p_organization_id
        and l.archived_at is null and l.source_payload->>'id'=v_old->>'id'
        and l.acquired_on::text=left(v_old->>'createdAt',10)) then
        v_blocked:=v_blocked+1;
      else v_existing:=v_existing+1; end if;
      continue;
    end if;

    v_inflow := coalesce(v_raw->'inflow_rt', '[]'::jsonb);
    if jsonb_typeof(v_inflow)='string' then
      begin v_inflow := (v_inflow#>>'{}')::jsonb;
      exception when invalid_text_representation then v_inflow:=jsonb_build_array(v_inflow#>>'{}'); end;
    end if;
    if jsonb_typeof(v_inflow)<>'array' then v_inflow:=jsonb_build_array(v_inflow); end if;
    v_first := lower(coalesce(v_inflow->>0,''));
    v_channel := case
      when v_first ~ 'instagram|facebook|메타' then '메타·인스타 퍼포먼스'
      when v_first ~ 'google|구글' then '구글 검색광고'
      when v_first ~ 'naver|네이버' then '네이버 검색광고'
      when v_first ~ 'youtube' then '유튜브'
      when v_first in ('etc','') then case when nullif(v_inflow->>1,'') is not null then '기타 · '||(v_inflow->>1) else '기타 유입' end
      else (select string_agg(value,' · ') from jsonb_array_elements_text(v_inflow)) end;
    v_buildup := case
      when coalesce(v_raw#>>'{client_info,need_buildup}','') ~ '투자' then '투자유치'
      when coalesce(v_raw#>>'{client_info,need_buildup}','') ~ '지원|정부' then '지원사업 관리'
      when coalesce(v_raw#>>'{client_info,need_buildup}','') ~ '개발|앱|웹|AX|MVP' then 'AX 개발'
      else '' end;
    v_phone := regexp_replace(coalesce(v_raw#>>'{client_contact,0,number}',''),'[^0-9]','','g');
    v_phone := case length(v_phone) when 11 then substr(v_phone,1,3)||'-'||substr(v_phone,4,4)||'-'||substr(v_phone,8,4)
      when 10 then substr(v_phone,1,3)||'-'||substr(v_phone,4,3)||'-'||substr(v_phone,7,4) else v_phone end;
    select t->>'value' into v_detail from jsonb_array_elements(
      case when jsonb_typeof(v_raw->'client_tag')='array' then v_raw->'client_tag' else '[]' end) t
      where t->>'type'='detail' limit 1;
    v_sheet := jsonb_build_object('source','newarrivals-v2','clientNo',v_raw->'client_no',
      'registeredAt',v_raw->>'reg_dt','inflowDate',v_day,'company',coalesce(v_raw->>'client_rep_name',''),
      'contact',coalesce(nullif(v_raw->>'client_name',''),v_raw#>>'{client_contact,0,name}',''),
      'phone',v_phone,'email',coalesce(nullif(v_raw->>'client_email','-'),''),
      'annualSales',coalesce(v_raw#>>'{client_info,annua_sales}',v_raw#>>'{iciq_items,annua_sales}',''),
      'annualSalesRaw',coalesce(v_raw#>>'{client_info,annua_sales}',v_raw#>>'{iciq_items,annua_sales}',''),
      'annualSalesSource','CRM 문의 체크값',
      'devStatus',coalesce(v_raw#>>'{client_info,dev_service_status}',v_raw#>>'{client_info,go_live}',''),
      'teamSize',coalesce(v_raw#>>'{client_info,member_of_total}',''),
      'sourcePage',coalesce(v_raw#>>'{iciq_items,page_from}',''),'inflowRaw',v_raw->'inflow_rt',
      'inquiry',btrim(regexp_replace(replace(coalesce(v_raw->>'iciq_content',''),'&nbsp;',' '),'<[^>]+>',' ','g')),
      'detailMemo',btrim(regexp_replace(replace(coalesce(v_raw->>'client_memo',''),'&nbsp;',' '),'<[^>]+>',' ','g')),
      'detailCode',v_detail,'projectNo',v_raw->'proj_no','firstVisitAt',coalesce(v_raw->>'client_first_visit',''),
      'syncedAt',(now() at time zone 'Asia/Seoul')::date::text);
    if v_old is null then
      v_new := jsonb_build_object('id',v_id,'company',coalesce(nullif(v_sheet->>'company',''),nullif(v_sheet->>'contact',''),'(무명)'),
        'contact',v_sheet->'contact','phone',v_phone,'email',v_sheet->'email','channel',v_channel,
        'createdAt',v_day,'projNo',v_raw->'proj_no','crmSheet',v_sheet,'calendarOnly',false,
        'creative','','buildup',v_buildup,'buildups',case when v_buildup='' then '[]'::jsonb else jsonb_build_array(v_buildup) end,
        'lineItems','[]'::jsonb,'grade','','status','신규 DB','ctype','신규','tmOwner','홍지수','salesOwner','',
        'expected',0,'contractAmount',0,'paid',0,'sent','{}'::jsonb,'newsletter',false,'pushLog','[]'::jsonb,
        'premeetingDoneAt','','premeetingAt','','bookedAt','','memo','',
        'crmFinanceAuto',jsonb_build_object('policy','future-only-v1','enabledAt',v_now),
        'history',jsonb_build_array(jsonb_build_object('date',v_day,'type','유입','note','CRM 서버 유입 자동 반영')));
      v_upserts := v_upserts||jsonb_build_array(v_new);
      v_leads := v_leads||jsonb_build_array(v_new);
      v_added := v_added+1;
    else
      v_id := v_old->>'id';
      v_new := v_old || jsonb_build_object('createdAt',v_day,'calendarOnly',false,
        'crmSheet',v_sheet || coalesce(v_old->'crmSheet','{}'::jsonb) || jsonb_build_object('inflowDate',v_day));
      if coalesce(v_old->>'channel','') in ('','CRM 캘린더','기타 유입') then v_new:=v_new||jsonb_build_object('channel',v_channel); end if;
      -- Do not change projNo/source kind of existing records: that would re-key relations.
      v_ops := '[]';
      foreach v_field in array array['createdAt','calendarOnly','crmSheet','channel'] loop
        if v_new->v_field is distinct from v_old->v_field then
          v_ops:=v_ops||jsonb_build_array(jsonb_build_object('op','set','path',jsonb_build_array(v_field),'value',v_new->v_field));
        end if;
      end loop;
      v_patches:=v_patches||jsonb_build_array(jsonb_build_object('id',v_id,'ops',v_ops));
      v_enriched:=v_enriched+1;
    end if;
    v_logs:=v_logs||jsonb_build_array(jsonb_build_object('id','crm-inflow-'||v_id||'-'||v_day,
      'at',v_now,'date',v_day,'leadId',v_id,'company',v_new->>'company','action','CRM 자동 동기화',
      'source','CRM 유입','actor','시스템','detail',case when v_old is null then '누락 유입 DB 생성' else '기존 기업의 유입일 보완 · 금액/입금/메모 보존' end,
      'meta',jsonb_build_object('inflowDate',v_day,'serverReconciled',true,
        'previousStatus',coalesce(v_old->>'status','미등록'),'nextStatus',v_new->>'status')));
  end loop;
  v_result:=jsonb_build_object('ok',v_blocked=0,'dryRun',p_dry_run,'rawClients',v_total,
    'added',v_added,'enriched',v_enriched,'alreadyApplied',v_existing,'excludedDeleted',v_deleted,
    'blocked',v_blocked,'start',p_start,'end',p_end,'revision',v_current.primary_revision);
  if p_dry_run or v_added+v_enriched=0 then return v_result; end if;
  v_mutation:=jsonb_build_object('origin','crm','reason','server-inflow-reconciliation',
    'collections',jsonb_build_object('leads',jsonb_build_object('idField','id','upsert',v_upserts,'patches',v_patches),
      'contractStatusLogs',jsonb_build_object('idField','id','upsert',v_logs)));
  v_key:='crm-inflow-'||md5(v_current.primary_revision||v_mutation::text);
  v_revision:=v_key;
  v_commit:=public.commit_primary_mutation(p_organization_id,v_key,v_current.primary_revision,v_revision,md5(v_mutation::text),v_mutation);
  if coalesce(v_commit->>'ok','false')<>'true' then raise exception 'inflow_commit_failed'; end if;
  -- Verify projection in the same transaction; a mismatch rolls back the entire commit.
  if exists(select 1 from jsonb_array_elements(v_upserts) l where not exists(
    select 1 from public.leads p where p.organization_id=p_organization_id and p.archived_at is null
      and p.source_payload->>'id'=l->>'id' and p.acquired_on=(l->>'createdAt')::date))
    or exists(select 1 from jsonb_array_elements(v_patches) l where not exists(
      select 1 from public.leads p where p.organization_id=p_organization_id and p.archived_at is null
        and p.source_payload->>'id'=l->>'id' and p.acquired_on is not null)) then
    raise exception 'inflow_projection_mismatch';
  end if;
  return v_result||jsonb_build_object('revision',v_revision,'verified',true);
end;
$$;
revoke all on function public.kpi_reconcile_crm_inflow(uuid,date,date,boolean) from public, anon, authenticated;
grant execute on function public.kpi_reconcile_crm_inflow(uuid,date,date,boolean) to service_role;
