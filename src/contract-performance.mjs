export const historyMoney = value => value === null || value === undefined ? '—' : '₩' + Number(value).toLocaleString('ko-KR');
const sum = rows => rows.reduce((s,r)=>s+Number(r.contract_amount||0),0);
export function buildMonthlyPerformance(leads, history, customerType, valueOf) {
  const byMonth=new Map();
  for(const lead of leads){
    if(lead.status!=='계약 완료' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(lead.contractAt||'') || !(valueOf(lead)>0)) continue;
    const month=lead.contractAt.slice(0,7);
    if(!byMonth.has(month)) byMonth.set(month,{month,source:'crm',rows:[],allRows:[],hasDetails:true});
    const item=byMonth.get(month); item.allRows.push(lead);
    if(customerType==='전체' || (lead.ctype||'신규')===customerType) item.rows.push(lead);
  }
  for(const item of byMonth.values()){
    item.amount=item.rows.reduce((s,l)=>s+valueOf(l),0); item.count=item.rows.length;
    item.owners=Object.fromEntries([...new Set(item.allRows.map(l=>l.salesOwner||'미배정'))].map(owner=>{
      const rows=item.rows.filter(l=>(l.salesOwner||'미배정')===owner);
      return [owner,{amount:rows.reduce((s,l)=>s+valueOf(l),0),count:rows.length}];
    }));
  }
  for(const record of history.months){
    const allRows=history.details.filter(d=>d.month===record.month);
    const rows=allRows.filter(d=>customerType==='전체' || d.customer_type===customerType);
    // Unknown source classification is not a zero and must never default to 신규.
    const unavailable=customerType!=='전체' && (!record.has_details || allRows.some(d=>!d.customer_type));
    const ownerNames=[...new Set([...allRows.map(d=>d.owner),...history.owners.filter(o=>o.month===record.month).map(o=>o.owner)])];
    const owners=Object.fromEntries(ownerNames.map(owner=>{
      const own=rows.filter(d=>d.owner===owner);
      return [owner,{amount:unavailable?null:sum(own),count:unavailable?null:own.length}];
    }));
    byMonth.set(record.month,{month:record.month,source:'sheet',record,rows,allRows,owners,
      hasDetails:record.has_details,unavailable,
      amount:unavailable?null:customerType==='전체'?Number(record.list_total_amount??record.reported_amount):sum(rows),
      count:unavailable?null:customerType==='전체'?record.reported_count:rows.length,
      overlapCount:byMonth.get(record.month)?.allRows.length||0});
  }
  return [...byMonth.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
export function monthDifference(current,previous,metric='amount'){
  if(!previous || current[metric]===null || previous[metric]===null || previous[metric]===0) return null;
  const next=new Date(previous.month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
  if(next.toISOString().slice(0,7)!==current.month) return null;
  const basis=m=>metric==='count'?(m.source==='sheet'?'reported-count':'crm-count'):
    m.source==='sheet'&&m.record.list_total_amount===null?'marketing-only':'all-contracts';
  if(basis(current)!==basis(previous)) return null;
  return (current[metric]-previous[metric])/previous[metric]*100;
}
