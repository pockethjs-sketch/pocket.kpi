create table public.marketing_inquiry_daily (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source text not null check(source in ('WEBSITE','META')),
  inquiry_date date not null,
  inquiry_count integer not null check(inquiry_count>=0),
  channels jsonb not null,
  source_hash text not null,
  collected_at timestamptz not null,
  primary key(organization_id,source,inquiry_date)
);
create table public.marketing_inquiry_sync_state (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source text not null check(source in ('WEBSITE','META')),
  status text not null check(status in ('SUCCESS','FAILED')),
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  range_start date,
  range_end date,
  source_total integer,
  source_hash text,
  expected_daily jsonb,
  error_code text,
  primary key(organization_id,source)
);
alter table public.crm_sync_runs add column website_inquiry_result jsonb;
alter table public.marketing_inquiry_daily enable row level security;
alter table public.marketing_inquiry_daily force row level security;
alter table public.marketing_inquiry_sync_state enable row level security;
alter table public.marketing_inquiry_sync_state force row level security;
revoke all on public.marketing_inquiry_daily,public.marketing_inquiry_sync_state from public,anon,authenticated;
grant select,insert,update on public.marketing_inquiry_daily,public.marketing_inquiry_sync_state to service_role;
create function public.kpi_commit_inquiry_days(p_organization_id uuid,p_source text,p_start date,p_end date,p_daily jsonb,p_total integer,p_hash text,p_as_of timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_sum bigint;v_count integer;v_existing timestamptz;v_stored bigint;v_stored_count integer;
begin
  if p_organization_id is null or p_source not in ('WEBSITE','META') or p_source is null or p_start is null or p_end is null or p_start>p_end or p_end>(now() at time zone 'Asia/Seoul')::date or p_end-p_start>3660
    or p_total is null or p_total<0 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_as_of is null or p_as_of>now()+interval '5 minutes' or jsonb_typeof(p_daily) is distinct from 'array' then raise exception 'inquiry_commit_invalid';end if;
  select count(*),sum((d->>'count')::integer) into v_count,v_sum from jsonb_array_elements(p_daily)d;
  if v_count<>p_end-p_start+1 or v_sum is distinct from p_total::bigint or (select count(distinct d->>'date') from jsonb_array_elements(p_daily)d)<>v_count
    or exists(select 1 from jsonb_array_elements(p_daily)d where (d->>'date')::date not between p_start and p_end or d->>'date' is null or (d->>'count')::integer<0 or d->>'count' is null or d->>'count' !~ '^[0-9]+$'
      or jsonb_typeof(d->'channels') is distinct from 'object' or (select count(*) from jsonb_object_keys(d->'channels'))<>4
      or not(d->'channels' ?& array['META','NAVER','GOOGLE','OTHER'])
      or exists(select 1 from jsonb_each_text(d->'channels') c where c.value !~ '^[0-9]+$')
      or (select sum(value::integer) from jsonb_each_text(d->'channels')) is distinct from (d->>'count')::bigint)
    then raise exception 'inquiry_aggregation_mismatch';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':inquiries:'||p_source,0));
  select max(collected_at) into v_existing from public.marketing_inquiry_daily where organization_id=p_organization_id and source=p_source and inquiry_date between p_start and p_end;
  if v_existing>p_as_of then raise exception 'inquiry_stale_write';end if;
  insert into public.marketing_inquiry_daily(organization_id,source,inquiry_date,inquiry_count,channels,source_hash,collected_at)
  select p_organization_id,p_source,(d->>'date')::date,(d->>'count')::integer,d->'channels',p_hash,p_as_of from jsonb_array_elements(p_daily)d
  on conflict(organization_id,source,inquiry_date) do update set inquiry_count=excluded.inquiry_count,channels=excluded.channels,source_hash=excluded.source_hash,collected_at=excluded.collected_at;
  select count(*),sum(inquiry_count) into v_stored_count,v_stored from public.marketing_inquiry_daily where organization_id=p_organization_id and source=p_source and inquiry_date between p_start and p_end and source_hash=p_hash and collected_at=p_as_of;
  if v_stored_count<>v_count or v_stored<>p_total then raise exception 'inquiry_storage_mismatch';end if;
  insert into public.marketing_inquiry_sync_state(organization_id,source,status,last_attempt_at,last_success_at,range_start,range_end,source_total,source_hash,expected_daily,error_code)
  values(p_organization_id,p_source,'SUCCESS',p_as_of,p_as_of,p_start,p_end,p_total,p_hash,p_daily,null)
  on conflict(organization_id,source) do update set status='SUCCESS',last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,range_start=excluded.range_start,range_end=excluded.range_end,source_total=excluded.source_total,source_hash=excluded.source_hash,expected_daily=excluded.expected_daily,error_code=null;
  return jsonb_build_object('verified',true,'source',p_source,'start',p_start,'end',p_end,'days',v_count,'total',p_total,'sourceHash',p_hash,'completedAt',p_as_of);
end;$$;
revoke all on function public.kpi_commit_inquiry_days(uuid,text,date,date,jsonb,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.kpi_commit_inquiry_days(uuid,text,date,date,jsonb,integer,text,timestamptz) to service_role;
comment on table public.marketing_inquiry_daily is 'Verified source/date counts only; no customer payload. Employee reads via domain API, server-only writes.';
