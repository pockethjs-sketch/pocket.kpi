import { _crmSyncDate } from '../../../scripts/contract-sheet-sync-core.mjs';
export function explicitReceiptDate(value,contractDate) {
  const text=String(value??'').trim(); if(!text)return '';
  const full=_crmSyncDate(text); if(full)return full;
  const m=text.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/);
  if(!m||!contractDate||Math.abs(Number(m[1])-Number(contractDate.slice(5,7)))>6)throw Error('sheet_receipt_date_ambiguous');
  const date=_crmSyncDate(contractDate.slice(0,4)+'-'+m[1]+'-'+m[2]);
  if(!date)throw Error('sheet_receipt_date_invalid'); return date;
}
