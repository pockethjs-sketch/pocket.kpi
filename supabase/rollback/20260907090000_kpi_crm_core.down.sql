-- Run only against the dedicated KPI project before production cutover.
-- This intentionally refuses to run after any migration is marked VERIFIED.
begin;
do $$ begin
  if exists (select 1 from public.migration_runs where status='VERIFIED') then
    raise exception 'rollback_blocked_verified_migration_exists';
  end if;
end $$;
drop view if exists public.deal_financial_summary;
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
commit;
