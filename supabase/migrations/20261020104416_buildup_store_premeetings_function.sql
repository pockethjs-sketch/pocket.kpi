-- Atomically replaces the upcoming window (today..+30 days) with the rows just read from the CRM.
-- Rows outside the window are refused; schedules missing from the CRM inside the window are marked removed.
-- Executed by the kpi-buildup-premeetings Edge Function as service_role (which also purges rows older than 30 days).
create or replace function public.buildup_store_premeetings(
  p_organization_id uuid, p_start date, p_end date, p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_rows integer; v_bad integer; v_distinct integer;
  v_written integer := 0; v_removed integer := 0; v_active integer := 0;
begin
  if p_organization_id is null or p_start is null or p_end is null or p_start > p_end or p_end - p_start > 120
    or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'invalid_premeeting_window';
  end if;
  v_rows := jsonb_array_length(p_rows);
  select count(*) into v_bad from jsonb_array_elements(p_rows) r
   where jsonb_typeof(r) <> 'object'
      or coalesce(r->>'scheduleNo', '') !~ '^[0-9]{1,20}$'
      or coalesce(r->>'company', '') = ''
      or coalesce(r->>'meetingAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
      or (r ? 'managers' and jsonb_typeof(r->'managers') <> 'array')
      or (r ? 'client' and jsonb_typeof(r->'client') <> 'object');
  if v_bad > 0 then raise exception 'invalid_premeeting_rows'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_rows) r
   where ((r->>'meetingAt')::timestamptz at time zone 'Asia/Seoul')::date not between p_start and p_end;
  if v_bad > 0 then raise exception 'premeeting_outside_window'; end if;
  select count(distinct r->>'scheduleNo') into v_distinct from jsonb_array_elements(p_rows) r;
  if v_distinct <> v_rows then raise exception 'duplicate_premeeting_rows'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('buildup_premeetings:' || p_organization_id::text, 0));

  insert into public.buildup_premeetings as t (
    organization_id, schedule_no, meeting_at, meeting_end_at, meeting_day, meeting_way, company, contact, sales_owner,
    managers, booked_by, crm_project_no, crm_client_no, visited, client, note, source_hash, first_seen_at, last_seen_at, removed_at)
  select p_organization_id, r->>'scheduleNo', (r->>'meetingAt')::timestamptz, nullif(r->>'meetingEndAt', '')::timestamptz,
    ((r->>'meetingAt')::timestamptz at time zone 'Asia/Seoul')::date, coalesce(r->>'way', ''), r->>'company',
    coalesce(r->>'contact', ''), coalesce(r->>'salesOwner', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(r->'managers', '[]'::jsonb))), '{}'::text[]),
    coalesce(r->>'bookedBy', ''), nullif(r->>'projectNo', ''), nullif(r->>'clientNo', ''),
    coalesce((r->>'visited')::boolean, false), coalesce(r->'client', '{}'::jsonb), coalesce(r->>'note', ''),
    md5(r::text), v_now, v_now, null
  from jsonb_array_elements(p_rows) r
  on conflict (organization_id, schedule_no) do update set
    meeting_at = excluded.meeting_at, meeting_end_at = excluded.meeting_end_at, meeting_day = excluded.meeting_day,
    meeting_way = excluded.meeting_way, company = excluded.company, contact = excluded.contact,
    sales_owner = excluded.sales_owner, managers = excluded.managers, booked_by = excluded.booked_by,
    crm_project_no = excluded.crm_project_no, crm_client_no = excluded.crm_client_no, visited = excluded.visited,
    client = excluded.client, note = excluded.note, source_hash = excluded.source_hash,
    last_seen_at = excluded.last_seen_at, removed_at = null;
  get diagnostics v_written = row_count;

  update public.buildup_premeetings t set removed_at = v_now
   where t.organization_id = p_organization_id and t.removed_at is null and t.meeting_day between p_start and p_end
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'scheduleNo' = t.schedule_no);
  get diagnostics v_removed = row_count;

  select count(*) into v_active from public.buildup_premeetings t
   where t.organization_id = p_organization_id and t.removed_at is null and t.meeting_day between p_start and p_end;
  if v_active <> v_rows then raise exception 'premeeting_store_mismatch'; end if;
  return jsonb_build_object('ok', true, 'start', p_start, 'end', p_end, 'received', v_rows, 'written', v_written,
    'removed', v_removed, 'active', v_active);
end;
$$;

revoke all on function public.buildup_store_premeetings(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.buildup_store_premeetings(uuid, date, date, jsonb) to service_role;
