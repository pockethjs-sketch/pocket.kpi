// Read-only import model: monthly performance is NOT a CRM lead or a receipt.
export const HISTORY_SHEET_ID = '10Zx1tNpdnVtTNK4beRBAyLji2X0u63w0QMdcy9EMsZ8';
const text = value => String(value ?? '').trim();
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const col = index => { let out=''; for(let n=index+1;n;n=Math.floor((n-1)/26)) out=String.fromCharCode(65+(n-1)%26)+out; return out; };
export function parseContractHistory(source) {
  if(source.spreadsheetId !== HISTORY_SHEET_ID) throw new Error('Unexpected history source');
  const months=new Map(), owners=[], details=[];
  let year='';
  source.performance.forEach((r,i)=>{
    const y=text(r[1]).match(/^(\d{4}) 포켓컴퍼니 전체 성과/); if(y) year=y[1];
    const m=text(r[1]).match(/^(\d{1,2})월$/);
    if(!year || !m || number(r[11])===null || number(r[7])===null) return;
    const month=`${year}-${m[1].padStart(2,'0')}`;
    if(months.has(month)) throw new Error('Duplicate summary month '+month);
    months.set(month,{month,reported_count:r[7],reported_amount:r[11],marketing_spend:number(r[2]),
      list_marketing_amount:null,list_total_amount:null,has_details:false,
      summary_range:`'월별성과'!B${i+1}:M${i+1}`,detail_range:null});
  });
  const starts=source.contracts.flatMap((r,i)=>{
    const match=text(r[1]).match(/^(\d{4})년\s*(\d{1,2})월 계약 리스트/);
    return match ? [{index:i,month:`${match[1]}-${match[2].padStart(2,'0')}`}] : [];
  });
  starts.forEach(({index,month},section)=>{
    const end=starts[section+1]?.index ?? source.contracts.length;
    const summary=months.get(month); if(!summary) throw new Error('Detail without summary '+month);
    summary.has_details=true; summary.detail_range=`'월별계약'!B${index+1}:AA${end}`;
    const ownerRow=source.contracts[index+1];
    const footer=source.contracts.slice(index+3,end).find(r=>/^(계약\s*(수|정리)|개별 건수)$/.test(text(r[1])));
    for(let c=2;c<=22;c+=5){
      const name=text(ownerRow[c]) || '미배정';
      let count=0;
      source.contracts.slice(index+3,end).forEach((r,offset)=>{
        if(typeof r[1]!=='number' || !text(r[c])) return;
        const amount=number(r[c+4]);
        if(amount===null && !r.slice(c+1,c+5).some(v=>text(v))) return;
        if(amount!==null && amount<0) throw new Error('Negative contract amount');
        const row=index+4+offset;
        details.push({month,source_cell:`${col(c)}${row}`,source_range:`'월별계약'!${col(c)}${row}:${col(c+4)}${row}`,
          owner:name,company:text(r[c]),channel:text(r[c+1]),grade:text(r[c+2]),program:text(r[c+3]),
          contract_amount:amount,customer_type:null,row_order:r[1]}); count++;
      });
      const amount=number(footer?.[c+4]);
      const rawCount=text(footer?.[c]);
      const declared=rawCount.match(/^(\d+)\s*[개건]$/);
      // Empty owner groups can contain copied placeholder counts. Preserve only meaningful owner groups.
      if(count || (text(ownerRow[c]) && amount>0)) owners.push({month,owner:name,source_column:c,
        reported_count:declared?Number(declared[1]):null,reported_count_text:rawCount,reported_amount:amount});
    }
    for(const r of source.contracts.slice(index+3,end)){
      if(/^당[월뤌] 마케팅 매출액$/.test(text(r[1]))) summary.list_marketing_amount=number(r[2]);
      if(text(r[1])==='추가계약 포함 매출') summary.list_total_amount=number(r[2]);
    }
  });
  return {sourceId:HISTORY_SHEET_ID,fetchedAt:source.fetchedAt,months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),owners,details};
}
