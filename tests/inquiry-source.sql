-- Synthetic fixture only. Always roll back. No customer/financial rows are read or written.
begin;
do $$
declare v_org uuid:=gen_random_uuid();v_result jsonb;v_daily jsonb:='[{"date":"2026-01-01","count":3,"channels":{"META":0,"NAVER":1,"GOOGLE":2,"OTHER":0}},{"date":"2026-01-02","count":0,"channels":{"META":0,"NAVER":0,"GOOGLE":0,"OTHER":0}}]';v_asof timestamptz:=now();v_failed boolean;
begin
  insert into public.organizations(id,slug,name) values(v_org,'synthetic-inquiry-'||substr(v_org::text,1,8),'Synthetic inquiry test');
  v_result:=public.kpi_commit_inquiry_days(v_org,'WEBSITE','2026-01-01','2026-01-02',v_daily,3,repeat('a',64),v_asof);
  if v_result->>'verified'<>'true' or (v_result->>'total')::integer<>3 then raise exception 'synthetic_commit_failed';end if;
  if (select sum(inquiry_count) from public.marketing_inquiry_daily where organization_id=v_org)<>3 then raise exception 'synthetic_sum_failed';end if;
  perform public.kpi_commit_inquiry_days(v_org,'WEBSITE','2026-01-01','2026-01-02',v_daily,3,repeat('a',64),v_asof);
  if (select count(*) from public.marketing_inquiry_daily where organization_id=v_org)<>2 then raise exception 'synthetic_repeat_failed';end if;
  v_failed:=false;
  begin perform public.kpi_commit_inquiry_days(v_org,'WEBSITE','2026-01-01','2026-01-02',v_daily,4,repeat('a',64),v_asof); exception when others then if sqlerrm='inquiry_aggregation_mismatch' then v_failed:=true;else raise;end if;end;
  if not v_failed then raise exception 'synthetic_bad_total_accepted';end if;
  v_failed:=false;
  begin perform public.kpi_commit_inquiry_days(v_org,'WEBSITE','2026-01-01','2026-01-02',v_daily,3,repeat('a',64),v_asof-interval '1 second'); exception when others then if sqlerrm='inquiry_stale_write' then v_failed:=true;else raise;end if;end;
  if not v_failed then raise exception 'synthetic_stale_write_accepted';end if;
  if has_table_privilege('anon','public.marketing_inquiry_daily','select') or has_table_privilege('authenticated','public.marketing_inquiry_daily','select')
    or has_function_privilege('authenticated','public.kpi_commit_inquiry_days(uuid,text,date,date,jsonb,integer,text,timestamptz)','execute')
    or not has_function_privilege('service_role','public.kpi_commit_inquiry_days(uuid,text,date,date,jsonb,integer,text,timestamptz)','execute') then raise exception 'synthetic_grant_failed';end if;
end;$$;
select true synthetic_inquiry_tests_passed;
rollback;
