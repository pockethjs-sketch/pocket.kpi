alter table public.payment_receipts
  alter column received_on drop not null;

comment on column public.payment_receipts.received_on is
  'Actual receipt date. NULL means the historical source confirms the amount but did not retain a trustworthy date.';
