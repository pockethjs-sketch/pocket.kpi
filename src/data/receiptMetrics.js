import {paymentRows} from './paymentSchedule.js';
// Actual-date receipts only. Unknown dates are not attributed to contract/inflow/sync months.
export function receiptPeriodMetrics(leads,range) {
  const contracts=[];
  for(const lead of leads||[]) {
    if(!lead||lead.archivedAt||lead.archived_at||lead.deletedAt)continue;
    let amount=0;
    for(const payment of paymentRows(lead)) {
      const day=String(payment?.paidAt||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||range&&(day<range[0]||day>range[1]))continue;
      const received=Number(payment.crmManaged?payment.depositAmount:payment.amount)||0;
      if(received>0)amount+=received;
    }
    if(amount>0)contracts.push({lead,amount});
  }
  return {contractCount:contracts.length,companyCount:new Set(contracts.map(({lead})=>String(lead.company||lead.id).trim().toLowerCase().replace(/\s+/g,''))).size,
    amount:contracts.reduce((sum,x)=>sum+x.amount,0)};
}
