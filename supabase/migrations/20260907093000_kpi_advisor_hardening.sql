begin;

drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_shared_org_select on public.profiles;

create policy profiles_org_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.state = 'ACTIVE'
      and mine.archived_at is null
      and theirs.user_id = profiles.id
      and theirs.state = 'ACTIVE'
      and theirs.archived_at is null
  )
);

create index if not exists audit_events_actor_user_idx
  on public.audit_events(actor_user_id) where actor_user_id is not null;
create index if not exists contract_events_created_by_idx
  on public.contract_events(created_by) where created_by is not null;
create index if not exists deal_activity_account_idx
  on public.deal_activity(account_id) where account_id is not null;
create index if not exists deal_activity_actor_user_idx
  on public.deal_activity(actor_user_id) where actor_user_id is not null;
create index if not exists deal_activity_deal_idx
  on public.deal_activity(deal_id) where deal_id is not null;
create index if not exists deals_account_idx
  on public.deals(account_id);
create index if not exists deals_lead_idx
  on public.deals(lead_id) where lead_id is not null;
create index if not exists deals_owner_user_idx
  on public.deals(owner_user_id) where owner_user_id is not null;
create index if not exists entity_field_ownership_claimed_by_idx
  on public.entity_field_ownership(claimed_by) where claimed_by is not null;
create index if not exists leads_account_idx
  on public.leads(account_id) where account_id is not null;
create index if not exists leads_owner_user_idx
  on public.leads(owner_user_id) where owner_user_id is not null;
create index if not exists migration_reconciliation_run_idx
  on public.migration_reconciliation(migration_run_id);
create index if not exists migration_runs_initiated_by_idx
  on public.migration_runs(initiated_by) where initiated_by is not null;
create index if not exists migration_runs_organization_idx
  on public.migration_runs(organization_id) where organization_id is not null;
create index if not exists payment_receipts_plan_idx
  on public.payment_receipts(payment_plan_id) where payment_plan_id is not null;

commit;
