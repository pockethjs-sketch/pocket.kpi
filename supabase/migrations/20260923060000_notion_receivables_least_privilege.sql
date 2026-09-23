begin;

-- This table was imported separately. Keep its source records out of direct browser access;
-- kpi-domain-api performs employee and organization checks before reading selected columns.
do $$
begin
  if to_regclass('public.notion_contract_payment_records') is null then
    raise exception 'notion_contract_payment_records_missing';
  end if;
end $$;

alter table public.notion_contract_payment_records enable row level security;
revoke all on table public.notion_contract_payment_records from public, anon, authenticated;

commit;
