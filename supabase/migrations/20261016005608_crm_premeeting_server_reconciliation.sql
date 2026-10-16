-- Server-only projection of already collected schedules. No CRM calls or browser grants.
-- Same identity/status rules as premeeting-sync-core, with raw latest-version dedup.
create or replace function public.kpi_reconcile_crm_premeetings(
  p_organization_id uuid, p_start date, p_end date, p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_state public.app_current_state%rowtype;
  r record; item record;
  working jsonb; matches jsonb; old_lead jsonb; new_lead jsonb;
  entries jsonb; old_entry jsonb; entry jsonb; managers jsonb;
  upserts jsonb := '[]'; patches jsonb := '[]'; logs jsonb := '[]'; ops jsonb;
  expected jsonb := '[]'; daily jsonb := '{}'; stored_daily jsonb := '{}';
  lead_key text; mid text; day text; owner_name text; field text; revision text;
  is_done boolean; count_raw integer := 0; blocked integer := 0; stored integer := 0;
  missing integer := 0; added integer := 0; updated integer := 0;
  mutation jsonb; result jsonb; committed jsonb;
  now_text text := to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_organization_id is null or p_start is null or p_end is null or p_start>p_end
    or p_end>(now() at time zone 'Asia/Seoul')::date or p_dry_run is null then
    raise exception 'invalid_premeeting_range';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
  select * into current_state from public.app_current_state where organization_id=p_organization_id for update;
  if not found then raise exception 'premeeting_state_missing'; end if;
  working := current_state.state_snapshot->'leads';
  if jsonb_typeof(working)<>'array' then raise exception 'premeeting_state_invalid'; end if;

  for r in
    with latest as (
      select distinct on(external_id) external_id,payload
      from public.crm_raw_records where organization_id=p_organization_id and record_type='MEETING'
      order by external_id,last_seen_at desc,id desc
    ) select external_id,payload,
      ((payload->>'start_dt')::timestamptz at time zone 'Asia/Seoul')::date as meeting_day
    from latest where payload->>'mr_type'='1'
      and ((payload->>'start_dt')::timestamptz at time zone 'Asia/Seoul')::date between p_start and p_end
    order by meeting_day,external_id
  loop
    mid := r.external_id; day := r.meeting_day::text; count_raw := count_raw+1;
    daily := jsonb_set(daily,array[day],to_jsonb(coalesce((daily->>day)::int,0)+1));
    if nullif(r.payload->>'ms_no','') is null or r.payload->>'ms_no'<>mid then
      blocked:=blocked+1; continue;
    end if;
    lead_key := coalesce('crm-'||nullif(r.payload->>'client_no',''),
      'crm-project-'||nullif(r.payload->>'proj_no',''),'crm-meeting-'||mid);
    select coalesce(jsonb_agg(l),'[]') into matches from jsonb_array_elements(working) l
    where l->>'id'=lead_key
      or (nullif(r.payload->>'proj_no','') is not null and l->>'projNo'=r.payload->>'proj_no')
      or exists(select 1 from jsonb_array_elements(
        (case when jsonb_typeof(l->'crmMeetings')='array' then l->'crmMeetings' else '[]'::jsonb end)||
        (case when jsonb_typeof(l->'crmMeeting')='object' then jsonb_build_array(l->'crmMeeting') else '[]'::jsonb end)
      ) m where m->>'msNo'=mid);
    if jsonb_array_length(matches)>1 then blocked:=blocked+1; continue; end if;
    old_lead := matches->0;
    if coalesce(old_lead->>'archivedAt',old_lead->>'archived_at',old_lead->>'deletedAt','')<>'' then
      blocked:=blocked+1; continue;
    end if;
    if old_lead is null and exists(select 1 from public.leads l
      where l.organization_id=p_organization_id and l.archived_at is not null
        and (l.source_payload->>'id'=lead_key or
          (nullif(r.payload->>'proj_no','') is not null and l.source_payload->>'projNo'=r.payload->>'proj_no'))) then
      blocked:=blocked+1; continue;
    end if;
    managers := case when jsonb_typeof(r.payload->'managers')='array' then r.payload->'managers' else '[]'::jsonb end;
    select coalesce(jsonb_agg(jsonb_build_object('no',m->'emp_no','name',m->'emp_name')),'[]') into managers
      from jsonb_array_elements(managers) m;
    owner_name := coalesce(managers->0->>'name',''); is_done := r.payload->>'mr_checked'='1';
    new_lead := coalesce(old_lead,jsonb_build_object('id',lead_key,'calendarOnly',true,
      'company',coalesce(nullif(r.payload->>'client_rep_name',''),nullif(r.payload->>'client_name',''),nullif(r.payload->>'mr_name',''),'(업체명 미등록)'),
      'contact',coalesce(r.payload->>'client_name',r.payload->'client_contact'->0->>'name',''),
      'phone',coalesce(r.payload->'client_contact'->0->>'number',''),'email',coalesce(r.payload->>'client_email',''),
      'channel','CRM 캘린더','creative','','buildup','','buildups','[]'::jsonb,'lineItems','[]'::jsonb,
      'grade','','status','신규 DB','ctype','신규','tmOwner','','salesOwner',owner_name,
      'expected',0,'contractAmount',0,'paid',0,'payments','[]'::jsonb,'sent','{}'::jsonb,'newsletter',false,
      'pushLog','[]'::jsonb,'projNo',r.payload->'proj_no','createdAt','','memo','','history','[]'::jsonb));
    if coalesce(new_lead->>'salesOwner','')='' and owner_name<>'' then
      new_lead:=jsonb_set(new_lead,'{salesOwner}',to_jsonb(owner_name)); end if;
    foreach field in array array['premeetingAt','bookedAt'] loop
      if coalesce(new_lead->>field,'')='' then new_lead:=jsonb_set(new_lead,array[field],to_jsonb(day)); end if;
    end loop;
    if coalesce(new_lead->>'projNo','')='' and nullif(r.payload->>'proj_no','') is not null then
      new_lead:=jsonb_set(new_lead,'{projNo}',r.payload->'proj_no'); end if;
    if is_done and coalesce(new_lead->>'premeetingDoneAt','')='' then
      new_lead:=jsonb_set(new_lead,'{premeetingDoneAt}',to_jsonb(day)); end if;
    if new_lead->>'status' in ('신규 DB','TM 진행중','프리미팅 확정') then
      new_lead:=jsonb_set(new_lead,'{status}',to_jsonb(case when is_done then '프리미팅 완료' else '프리미팅 확정' end));
    end if;
    -- Never undo a manual drop/contract state to force a company into this list.
    if new_lead->>'status' not in ('프리미팅 확정','프리미팅 완료','견적·제안 발송','계약 완료') then
      blocked:=blocked+1; continue;
    end if;
    entries:=case when jsonb_typeof(new_lead->'crmMeetings')='array' then new_lead->'crmMeetings' else '[]'::jsonb end;
    if jsonb_typeof(new_lead->'crmMeeting')='object' and not exists(
      select 1 from jsonb_array_elements(entries) m where m->>'msNo'=new_lead->'crmMeeting'->>'msNo') then
      entries:=entries||jsonb_build_array(new_lead->'crmMeeting'); end if;
    select m into old_entry from jsonb_array_elements(entries) m where m->>'msNo'=mid limit 1;
    entry:=coalesce(old_entry,'{}')||jsonb_build_object('source','mr_schedules','msNo',r.payload->'ms_no',
      'type',1,'checked',case when is_done then 1 else 0 end,'startAt',r.payload->>'start_dt',
      'endAt',coalesce(r.payload->>'end_dt',''),'managers',managers);
    select coalesce(jsonb_agg(m order by m->>'startAt',m->>'msNo'),'[]') into entries from (
      select m from jsonb_array_elements(entries) m where m->>'msNo' is distinct from mid union all select entry
    ) e(m);
    new_lead:=new_lead||jsonb_build_object('crmMeetings',entries,'crmMeeting',entries->(jsonb_array_length(entries)-1));
    if old_entry is distinct from entry then
      new_lead:=jsonb_set(new_lead,'{history}',coalesce(new_lead->'history','[]')||jsonb_build_array(jsonb_build_object(
        'date',day,'type',case when is_done then '미팅' else '일정' end,
        'note','CRM 프리미팅 동기화 · #'||mid||case when is_done then ' · 내방완료' else ' · 방문 미확인' end)));
    end if;
    expected:=expected||jsonb_build_array(jsonb_build_object('leadId',new_lead->>'id','meeting',entry,'day',day));
    select coalesce(jsonb_agg(case when l->>'id'=new_lead->>'id' then new_lead else l end order by ord),'[]') into working
      from jsonb_array_elements(working) with ordinality t(l,ord);
    if old_lead is null then working:=working||jsonb_build_array(new_lead); end if;
  end loop;

  -- Construct a single patch per company; multiple schedule IDs remain separate.
  for item in select distinct on(l->>'id') l from jsonb_array_elements(working) l
    join jsonb_array_elements(expected) e on l->>'id'=e->>'leadId' loop
    select l into old_lead from jsonb_array_elements(current_state.state_snapshot->'leads') l where l->>'id'=item.l->>'id';
    if old_lead is not distinct from item.l then continue; end if;
    if old_lead is null then upserts:=upserts||jsonb_build_array(item.l); added:=added+1;
    else
      select jsonb_agg(jsonb_build_object('op','set','path',jsonb_build_array(k),'value',v)) into ops
        from jsonb_each(item.l) e(k,v) where old_lead->k is distinct from v;
      patches:=patches||jsonb_build_array(jsonb_build_object('id',item.l->>'id','ops',ops)); updated:=updated+1;
    end if;
    logs:=logs||jsonb_build_array(jsonb_build_object('id','premeeting-server-'||md5((item.l->>'id')||(item.l->'crmMeetings')::text||current_state.primary_revision),
      'at',now_text,'date',p_end,'company',item.l->>'company','leadId',item.l->>'id','action','CRM 동기화','source','CRM 캘린더','actor','시스템',
      'detail','저장 원본 프리미팅 반영 · '||p_start||'~'||p_end,
      'meta',jsonb_build_object('previousStatus',old_lead->>'status','nextStatus',item.l->>'status','start',p_start,'end',p_end)));
  end loop;
  select count(*) into missing from jsonb_array_elements(expected) x where not exists(
    select 1 from public.leads l cross join lateral jsonb_array_elements(coalesce(l.source_payload->'crmMeetings','[]')) m
    where l.organization_id=p_organization_id and l.archived_at is null and l.source_payload->>'id'=x->>'leadId'
      and m=x->'meeting' and l.status_code in ('프리미팅 확정','프리미팅 완료','견적·제안 발송','계약 완료'));
  result:=jsonb_build_object('ok',blocked=0,'start',p_start,'end',p_end,'total',count_raw,'sourceDaily',daily,
    'added',added,'updated',updated,'blocked',blocked,'missing',missing,'dryRun',p_dry_run,'revision',current_state.primary_revision);
  if p_dry_run or blocked>0 then return result||jsonb_build_object('verified',blocked=0 and missing=0); end if;
  if added+updated>0 then
    mutation:=jsonb_build_object('origin','crm','reason','stored_premeeting_sync','collections',jsonb_build_object(
      'leads',jsonb_build_object('idField','id','upsert',upserts,'patches',patches),
      'contractStatusLogs',jsonb_build_object('idField','id','upsert',logs)));
    revision:='crm-premeeting-'||md5(current_state.primary_revision||mutation::text);
    committed:=public.commit_primary_mutation(p_organization_id,revision,current_state.primary_revision,revision,md5(mutation::text),mutation);
    if committed->>'ok'<>'true' then raise exception 'premeeting_commit_failed'; end if;
  else revision:=current_state.primary_revision;
  end if;
  for item in select x from jsonb_array_elements(expected) x loop
    if not exists(select 1 from public.leads l
      join public.app_current_state s on s.organization_id=l.organization_id
      cross join lateral jsonb_array_elements(s.state_snapshot->'leads') sl
      cross join lateral jsonb_array_elements(coalesce(l.source_payload->'crmMeetings','[]')) m
      where l.organization_id=p_organization_id and l.archived_at is null
        and l.source_payload->>'id'=item.x->>'leadId' and sl->>'id'=item.x->>'leadId'
        and sl=l.source_payload and m=item.x->'meeting'
        and l.status_code in ('프리미팅 확정','프리미팅 완료','견적·제안 발송','계약 완료')) then
      raise exception 'premeeting_projection_mismatch';
    end if;
    day:=item.x->>'day'; stored:=stored+1;
    stored_daily:=jsonb_set(stored_daily,array[day],to_jsonb(coalesce((stored_daily->>day)::int,0)+1));
  end loop;
  if stored<>count_raw or stored_daily<>daily then raise exception 'premeeting_projection_mismatch'; end if;
  return result||jsonb_build_object('verified',true,'missing',0,'stored',stored,'storedDaily',stored_daily,'revision',revision,'completedAt',now_text);
end;
$$;
revoke all on function public.kpi_reconcile_crm_premeetings(uuid,date,date,boolean) from public,anon,authenticated;
grant execute on function public.kpi_reconcile_crm_premeetings(uuid,date,date,boolean) to service_role;
