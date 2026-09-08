alter table public.accounts
  drop constraint accounts_organization_id_external_crm_id_key;
create unique index accounts_org_external_crm_id_uidx
  on public.accounts (organization_id, external_crm_id)
  where external_crm_id is not null;

alter table public.leads
  drop constraint leads_organization_id_external_crm_id_key;
create unique index leads_org_external_crm_id_uidx
  on public.leads (organization_id, external_crm_id)
  where external_crm_id is not null;

alter table public.deals
  drop constraint deals_organization_id_external_crm_id_key;
create unique index deals_org_external_crm_id_uidx
  on public.deals (organization_id, external_crm_id)
  where external_crm_id is not null;

alter table public.payment_receipts
  drop constraint payment_receipts_organization_id_external_transaction_id_key;
create unique index payment_receipts_org_external_transaction_id_uidx
  on public.payment_receipts (organization_id, external_transaction_id)
  where external_transaction_id is not null;
