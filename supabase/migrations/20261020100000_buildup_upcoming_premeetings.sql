-- Upcoming CRM premeetings for the buildup workspace overview ("프로젝트 전체 보기"), today onward.
-- Server-only. The kpi-buildup-premeetings Edge Function (pg_cron, 08:00 KST daily) reads the CRM premeeting
-- calendar for today..+30 days and replaces that window atomically through buildup_store_premeetings().
-- KPI leads, raw CRM evidence (crm_raw_records) and the KPI premeeting projection are neither read nor changed.
-- Phone numbers, e-mail addresses and addresses are not stored. Browser roles receive no grants; employees
-- read the list only through kpi-buildup-api after session + ACTIVE membership checks.

create table if not exists public.buildup_premeetings (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  schedule_no text not null,
  meeting_at timestamptz not null,
  meeting_end_at timestamptz,
  meeting_day date not null,
  meeting_way text not null default '',
  company text not null,
  contact text not null default '',
  sales_owner text not null default '',
  managers text[] not null default '{}',
  booked_by text not null default '',
  crm_project_no text,
  crm_client_no text,
  visited boolean not null default false,
  client jsonb not null default '{}'::jsonb,
  note text not null default '',
  source_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint buildup_premeetings_pkey primary key (organization_id, schedule_no),
  constraint buildup_premeetings_schedule_format check (schedule_no ~ '^[0-9]{1,20}$'),
  constraint buildup_premeetings_numbers check (
    (crm_project_no is null or crm_project_no ~ '^[0-9]{1,20}$') and (crm_client_no is null or crm_client_no ~ '^[0-9]{1,20}$')),
  constraint buildup_premeetings_text_sizes check (
    char_length(company) between 1 and 200 and char_length(contact) <= 100 and char_length(sales_owner) <= 100
    and char_length(booked_by) <= 100 and char_length(meeting_way) <= 20 and char_length(note) <= 1000
    and cardinality(managers) <= 10),
  constraint buildup_premeetings_end_after_start check (meeting_end_at is null or meeting_end_at >= meeting_at),
  constraint buildup_premeetings_client_object check (jsonb_typeof(client) = 'object' and pg_column_size(client) <= 8000)
);

create index if not exists buildup_premeetings_upcoming
  on public.buildup_premeetings (organization_id, meeting_day) where removed_at is null;

create table if not exists public.buildup_premeeting_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  trigger text not null check (trigger in ('cron', 'manual')),
  window_start date not null,
  window_end date not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  fetched integer check (fetched is null or fetched >= 0),
  stored integer check (stored is null or stored >= 0),
  removed integer check (removed is null or removed >= 0),
  skipped integer check (skipped is null or skipped >= 0),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,60}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint buildup_premeeting_runs_window check (window_start <= window_end)
);

create index if not exists buildup_premeeting_runs_recent
  on public.buildup_premeeting_runs (organization_id, started_at desc);

alter table public.buildup_premeetings enable row level security;
alter table public.buildup_premeetings force row level security;
alter table public.buildup_premeeting_runs enable row level security;
alter table public.buildup_premeeting_runs force row level security;

revoke all on public.buildup_premeetings, public.buildup_premeeting_runs from anon, authenticated;
revoke all on sequence public.buildup_premeeting_runs_id_seq from anon, authenticated;
grant select, insert, update, delete on public.buildup_premeetings to service_role;
grant select, insert, update on public.buildup_premeeting_runs to service_role;
grant usage, select on sequence public.buildup_premeeting_runs_id_seq to service_role;

comment on table public.buildup_premeetings is
  'Upcoming CRM premeetings (today..+30 days) for the buildup workspace overview. Server-only; refreshed 08:00 KST by kpi-buildup-premeetings. No phone, e-mail or address. removed_at marks schedules that left the CRM window (cancelled or moved).';
comment on table public.buildup_premeeting_runs is
  'Refresh runs of the upcoming premeeting list: window, counts and short error codes only.';

-- Atomically replaces the upcoming window with the rows just read from the CRM.
-- Rows outside the window are refused; schedules missing from the CRM inside the window are marked removed;
-- rows more than 30 days in the past are purged. Executed by the Edge Function as service_role.
create or replace function public.buildup_store_premeetings(
  p_organization_id uuid, p_start date, p_end date, p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_rows integer; v_bad integer; v_distinct integer;
  v_written integer := 0; v_removed integer := 0; v_purged integer := 0; v_active integer := 0;
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

  delete from public.buildup_premeetings t where t.organization_id = p_organization_id and t.meeting_day < p_start - 30;
  get diagnostics v_purged = row_count;

  select count(*) into v_active from public.buildup_premeetings t
   where t.organization_id = p_organization_id and t.removed_at is null and t.meeting_day between p_start and p_end;
  if v_active <> v_rows then raise exception 'premeeting_store_mismatch'; end if;
  return jsonb_build_object('ok', true, 'start', p_start, 'end', p_end, 'received', v_rows, 'written', v_written,
    'removed', v_removed, 'purged', v_purged, 'active', v_active);
end;
$$;

revoke all on function public.buildup_store_premeetings(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.buildup_store_premeetings(uuid, date, date, jsonb) to service_role;

-- 08:00 KST (23:00 UTC) daily. Reuses the existing internal-schedule credentials in Vault (project Edge JWT for the
-- gateway and the internal cron secret); the function URL is derived from the stored marketing function URL.
do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'pocket-buildup-premeetings' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'pocket-buildup-premeetings',
    '0 23 * * *',
    $job$
      select net.http_post(
        url := replace((select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_function_url' limit 1),
          '/functions/v1/kpi-marketing-sync', '/functions/v1/kpi-buildup-premeetings'),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_anon_key' limit 1),
          'x-kpi-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='kpi_marketing_cron_secret' limit 1)
        ),
        body := jsonb_build_object('trigger','cron'),
        timeout_milliseconds := 120000
      );
    $job$
  );
end;
$$;
