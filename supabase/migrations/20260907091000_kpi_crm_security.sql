begin;

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_org and m.user_id = (select auth.uid())
      and m.state = 'ACTIVE' and m.archived_at is null
  );
$$;

create or replace function private.is_org_admin(target_org uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_org and m.user_id = (select auth.uid())
      and m.role in ('OWNER','ADMIN') and m.state = 'ACTIVE' and m.archived_at is null
  );
$$;

create or replace function private.block_audit_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'append_only_table';
end;
$$;

create trigger audit_events_append_only before update or delete on public.audit_events
for each row execute function private.block_audit_mutation();
create trigger deal_activity_append_only before update or delete on public.deal_activity
for each row execute function private.block_audit_mutation();
create trigger contract_events_append_only before update or delete on public.contract_events
for each row execute function private.block_audit_mutation();

create or replace view public.deal_financial_summary with (security_invoker = true) as
select d.id as deal_id, d.organization_id, d.quoted_amount, d.contract_amount,
       coalesce(p.planned_amount, 0::numeric) as planned_amount,
       coalesce(r.received_amount, 0::numeric) as received_amount,
       greatest(coalesce(d.contract_amount, 0::numeric) - coalesce(r.received_amount, 0::numeric), 0::numeric) as outstanding_amount
from public.deals d
left join (select deal_id, sum(planned_amount) planned_amount from public.payment_plans where archived_at is null group by deal_id) p on p.deal_id=d.id
left join (select deal_id, sum(received_amount) received_amount from public.payment_receipts where archived_at is null group by deal_id) r on r.deal_id=d.id
where d.archived_at is null;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','organization_memberships','accounts','leads','deals','contract_events',
    'payment_plans','payment_receipts','deal_activity','marketing_daily_spend','provider_sync_state',
    'idempotency_keys','entity_field_ownership','audit_events','migration_runs','migration_reconciliation'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

create policy organizations_member_select on public.organizations for select to authenticated
using (private.is_org_member(id));
create policy profiles_self_select on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profiles_shared_org_select on public.profiles for select to authenticated using (
  exists (
    select 1 from public.organization_memberships mine
    join public.organization_memberships theirs on theirs.organization_id=mine.organization_id
    where mine.user_id=(select auth.uid()) and mine.archived_at is null and theirs.user_id=profiles.id and theirs.archived_at is null
  )
);
create policy memberships_member_select on public.organization_memberships for select to authenticated
using (private.is_org_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array['accounts','leads','deals','contract_events','payment_plans','payment_receipts','deal_activity','marketing_daily_spend','provider_sync_state'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', t || '_member_select', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

grant select on public.organizations, public.profiles, public.organization_memberships to authenticated;
grant select on public.deal_financial_summary to authenticated;
revoke all on public.idempotency_keys, public.audit_events, public.migration_runs, public.migration_reconciliation from anon, authenticated;
revoke all on public.entity_field_ownership from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;

comment on table public.idempotency_keys is 'Server-only mutation registry; browsers never write directly.';
comment on table public.entity_field_ownership is 'Server-only ownership registry. USER claims outrank CRM and advertising synchronization; automated sources may never clear or replace USER-owned fields.';
comment on column public.accounts.field_owners is 'Map of field name to USER/CRM/GOOGLE_SHEETS/etc.; automated sync may update only fields it owns.';
comment on column public.leads.field_owners is 'User-owned fields cannot be overwritten or cleared by background synchronization.';
comment on column public.deals.quoted_amount is 'Quoted amount; never substitute contract or receipt amounts.';
comment on column public.deals.contract_amount is 'Final contracted amount; never substitute quoted or receipt amounts.';
comment on column public.payment_plans.planned_amount is 'Expected installment amount, separate from actual receipts.';
comment on column public.payment_receipts.received_amount is 'Actual received amount.';

commit;
