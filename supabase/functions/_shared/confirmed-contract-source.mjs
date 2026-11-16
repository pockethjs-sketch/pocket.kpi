import { _crmParseContractSource, _crmSyncAliases, _crmSyncDate } from '../../../scripts/contract-sheet-sync-core.mjs';
import { parseReportCsv, CONTRACT_SHEET_URL } from './contract-sheet-report.mjs';

import { explicitReceiptDate } from './contract-receipt-date.mjs';
export { explicitReceiptDate };
const normalize=value=>String(value||'').toLowerCase().replace(/\s+/g,'');
export async function confirmedContractSource(csv, manifest, hash) {
  const values=parseReportCsv(csv),headers=values[0].map(x=>x.replace(/\s/g,''));
  for(const header of ['날짜','업체명','프로젝트','별도가','대금지급확인','입금일'])if(headers.filter(x=>x===header).length!==1)throw Error('sheet_headers_invalid');
  const index=Object.fromEntries(headers.map((x,i)=>[x,i]));
  if(values.slice(1).some(v=>(String(v[index['프로젝트']]||'').trim()||String(v[index['별도가']]||'').trim())&&
    ((String(v[index['날짜']]||'').trim()&&!_crmSyncDate(v[index['날짜']]))||(String(v[index['업체명']]||'').trim()&&!String(v[index['날짜']]||'').trim()))))throw Error('sheet_row_date_invalid');
  const groups=_crmParseContractSource(values,value=>value,'2026-09-01'),all=groups.flatMap(g=>g.rows),rows=[];
  for(const approved of manifest){
    const candidates=all.filter(r=>r.date===approved.date&&r.amount===approved.amount&&r.paymentPercent===approved.percent);
    const matching=[];
    for(const row of candidates)if(await hash(groups.find(g=>g.rows.includes(row)).sourceKey,'md5')===approved.keyHash)matching.push(row);
    if(matching.length!==1)throw Error('sheet_approved_contract_changed');
    const r=matching[0];
    const identity=JSON.stringify([_crmSyncAliases(r.company)[0]||normalize(r.company),r.date,normalize(r.dealText)]);
    if(all.filter(x=>JSON.stringify([_crmSyncAliases(x.company)[0]||normalize(x.company),x.date,normalize(x.dealText)])===identity).length!==1)throw Error('sheet_contract_duplicate');
    const paid=Math.round(r.amount*r.paymentPercent/100),paidAt=explicitReceiptDate(values[r.row-1][index['입금일']],r.date);
    if(!r.dealText||!Number.isSafeInteger(r.amount)||r.amount<=0||!(paid>0)||paid>r.amount)throw Error('sheet_amount_invalid');
    rows.push({keyHash:approved.keyHash,contractKey:await hash(identity),row:r.row,contractDate:r.date,amount:r.amount,paid,percent:r.paymentPercent,paidAt,
      company:r.company,ctype:r.ctype||'미확인',service:r.service||'',mode:approved.mode,parentIdHash:approved.parentIdHash,parentBeforeHash:approved.parentBeforeHash});
  }
  return {sourceHash:await hash(csv),sourceRowCount:values.length,rows};
}
export async function readConfirmedContracts(manifest, hash, fetcher=fetch) {
  const response=await fetcher(CONTRACT_SHEET_URL,{headers:{accept:'text/csv'},signal:AbortSignal.timeout(25000)});
  if(!response.ok||/accounts\.google\.com/.test(response.url||'')||!/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type')||''))throw Error('sheet_source_unavailable');
  return confirmedContractSource(await response.text(),manifest,hash);
}
