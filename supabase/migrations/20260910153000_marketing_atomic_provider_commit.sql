begin;

create or replace function public.kpi_commit_marketing_provider(
  p_organization_id uuid,
  p_provider public.kpi_source,
  p_run_id text,
  p_start date,
  p_end date,
  p_rows jsonb,
  p_checkpoint jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_days integer;
  v_row_count bigint;
  v_distinct_dates bigint;
  v_first_date date;
  v_latest_date date;
  v_amount numeric;
  v_archived bigint;
begin
  if p_provider not in ('META'::public.kpi_source, 'NAVER'::public.kpi_source, 'GOOGLE_ADS'::public.kpi_source) then
    raise exception 'unsupported_marketing_provider';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 31 then
    raise exception 'invalid_marketing_range';
  end if;
  if nullif(btrim(p_run_id), '') is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'invalid_marketing_payload';
  end if;

  v_expected_days := p_end - p_start + 1;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_provider::text, 0)
  );

  with parsed as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      spend_date date,
      provider text,
      channel_code text,
      campaign_external_id text,
      campaign_name text,
      spend_amount numeric,
      impressions bigint,
      clicks bigint,
      conversions numeric,
      source_row_key text,
      payload jsonb
    )
  )
  select count(*), count(distinct spend_date), min(spend_date), max(spend_date), coalesce(sum(spend_amount), 0)
  into v_row_count, v_distinct_dates, v_first_date, v_latest_date, v_amount
  from parsed;

  if v_distinct_dates <> v_expected_days or v_first_date <> p_start or v_latest_date <> p_end then
    raise exception 'marketing_date_coverage_failed';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(
      spend_date date,
      provider text,
      channel_code text,
      spend_amount numeric,
      impressions bigint,
      clicks bigint,
      conversions numeric,
      source_row_key text
    )
    where spend_date not between p_start and p_end
       or provider is distinct from p_provider::text
       or nullif(btrim(channel_code), '') is null
       or nullif(btrim(source_row_key), '') is null
       or coalesce(spend_amount, -1) < 0
       or coalesce(impressions, 0) < 0
       or coalesce(clicks, 0) < 0
       or coalesce(conversions, 0) < 0
       or (p_provider = 'META'::public.kpi_source and channel_code not in (
         'META_LEAD', 'META_POCKET_TRAFFIC', 'META_BUILDER_TRAFFIC', 'META_OTHER'
       ))
       or (p_provider = 'NAVER'::public.kpi_source and channel_code <> 'NAVER')
       or (p_provider = 'GOOGLE_ADS'::public.kpi_source and channel_code <> 'GOOGLE')
  ) then
    raise exception 'marketing_row_validation_failed';
  end if;

  update public.marketing_daily_spend
  set archived_at = coalesce(archived_at, now()), updated_at = now()
  where organization_id = p_organization_id
    and provider = p_provider
    and spend_date between p_start and p_end
    and archived_at is null
    and payload->>'collector' = 'supabase-edge';
  get diagnostics v_archived = row_count;

  insert into public.marketing_daily_spend (
    organization_id, spend_date, provider, channel_code, campaign_external_id,
    campaign_name, spend_amount, impressions, clicks, conversions,
    source_row_key, source_hash, payload, projected_revision, archived_at, updated_at
  )
  select
    p_organization_id,
    x.spend_date,
    p_provider,
    x.channel_code,
    nullif(x.campaign_external_id, ''),
    nullif(x.campaign_name, ''),
    x.spend_amount,
    coalesce(x.impressions, 0),
    coalesce(x.clicks, 0),
    coalesce(x.conversions, 0),
    x.source_row_key,
    md5(p_run_id || ':' || x.source_row_key || ':' || x.spend_amount::text),
    coalesce(x.payload, '{}'::jsonb) || jsonb_build_object(
      'collector', 'supabase-edge',
      'runId', p_run_id,
      'validated', true
    ),
    null,
    null,
    now()
  from jsonb_to_recordset(p_rows) as x(
    spend_date date,
    provider text,
    channel_code text,
    campaign_external_id text,
    campaign_name text,
    spend_amount numeric,
    impressions bigint,
    clicks bigint,
    conversions numeric,
    source_row_key text,
    payload jsonb
  )
  on conflict (organization_id, provider, spend_date, campaign_external_id, source_row_key)
  do update set
    channel_code = excluded.channel_code,
    campaign_name = excluded.campaign_name,
    spend_amount = excluded.spend_amount,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    conversions = excluded.conversions,
    source_hash = excluded.source_hash,
    payload = excluded.payload,
    projected_revision = null,
    archived_at = null,
    updated_at = now();

  insert into public.provider_sync_state (
    organization_id, provider, status, checkpoint, last_attempt_at,
    last_success_at, latest_source_date, row_count, amount_total,
    error_code, error_detail, updated_at
  ) values (
    p_organization_id, p_provider, 'SUCCESS',
    coalesce(p_checkpoint, '{}'::jsonb) || jsonb_build_object(
      'runId', p_run_id,
      'start', p_start,
      'end', p_end,
      'collector', 'supabase-edge',
      'atomicCommit', true
    ),
    now(), now(), v_latest_date, v_row_count, v_amount, null, null, now()
  )
  on conflict (organization_id, provider) do update set
    status = excluded.status,
    checkpoint = excluded.checkpoint,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at,
    latest_source_date = excluded.latest_source_date,
    row_count = excluded.row_count,
    amount_total = excluded.amount_total,
    error_code = null,
    error_detail = null,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'provider', p_provider,
    'runId', p_run_id,
    'rows', v_row_count,
    'days', v_distinct_dates,
    'amount', v_amount,
    'latestDate', v_latest_date,
    'archivedPreviousRows', v_archived
  );
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
  set archived_at = coalesce(projected.archived_at, now()), updated_at = now()
  where projected.organization_id = p_organization_id
    and projected.payload->>'projection' = 'v3-state'
    and projected.archived_at is null
    and exists (
      select 1
      from public.marketing_daily_spend direct
      where direct.organization_id = projected.organization_id
        and direct.spend_date = projected.spend_date
        and direct.provider = projected.provider
        and direct.archived_at is null
        and direct.payload->>'collector' = 'supabase-edge'
        and direct.payload->>'validated' = 'true'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.kpi_commit_marketing_provider(uuid,public.kpi_source,text,date,date,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.kpi_commit_marketing_provider(uuid,public.kpi_source,text,date,date,jsonb,jsonb)
  to service_role;

revoke all on function private.prefer_direct_marketing(uuid) from public, anon, authenticated;

comment on function public.kpi_commit_marketing_provider(uuid,public.kpi_source,text,date,date,jsonb,jsonb)
is 'Validates complete provider/date coverage and atomically replaces only validated Supabase Edge marketing rows.';

commit;
