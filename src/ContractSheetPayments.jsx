import React, { useEffect, useMemo, useState } from 'react';
import ContractOwnerSheet from './ContractOwnerSheet.jsx';
import { useExcelExport } from './ExcelExport.jsx';
import { excelTable } from './data/excelTable.js';

const money = n=>'₩'+Number(n||0).toLocaleString('ko-KR');
export default function ContractSheetPayments({range,periodLabel}) {
  const [storedReport,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [type,setType]=useState('전체'),[owner,setOwner]=useState('전체'),[search,setSearch]=useState(''),[view,setView]=useState('owner');
  const start=range?.[0] || '2000-01-01',end=range?.[1] || new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  // Do not show/export an old period even for the render before effect cleanup.
  const report=storedReport?.start===start&&storedReport?.end===end?storedReport:null;
  useEffect(()=>{
    const controller=new AbortController();let current=true;
    setLoading(true);setReport(null);setError('');
    const timer=setTimeout(()=>controller.abort(),35000);
    (async()=>{
      try {
        const headers=await window.kpiEmployeeHeaders();
        const response=await fetch('https://ilnklntqkdbbtzzbhqrl.supabase.co/functions/v1/kpi-contract-sheet-report?'+new URLSearchParams({start,end}),{headers,signal:controller.signal,cache:'no-store'});
        const body=await response.json();
        if(!response.ok || body.error || body.schemaVersion!=='sheet-payment-report-v1' || body.start!==start || body.end!==end || !Array.isArray(body.rows) || !Array.isArray(body.issues) || body.confirmedRows!==body.rows.length || body.total!==body.rows.reduce((s,r)=>s+r.amount,0)) throw Error(body.error || 'sheet_report_invalid');
        if(current)setReport(body);
      }catch(e){if(current)setError(e.name==='AbortError'?'sheet_read_timeout':/^sheet_[a-z_]+$/.test(e.message)?e.message:'sheet_read_failed');}
      finally{clearTimeout(timer);if(current)setLoading(false);}
    })();
    return()=>{current=false;controller.abort();clearTimeout(timer);};
  },[start,end,reload]);
  const sourceRows=(report?.rows || []).filter(r=>(type==='전체'||r.ctype===type)&&(owner==='전체'||r.owner===owner)&&(!search.trim()||[r.company,r.owner,r.program].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
  const rows=useMemo(()=>{
    const grouped=new Map();
    for(const r of sourceRows){const key=JSON.stringify([r.company,r.owner,r.ctype]);const v=grouped.get(key)||{id:key,company:r.company,salesOwner:r.owner,ctype:r.ctype,amount:0,programs:[],dates:[],sourceRows:[]};v.amount+=r.amount;v.programs.push(r.program);v.dates.push(r.date);v.sourceRows.push(r.sourceRow);grouped.set(key,v);}
    return [...grouped.values()].sort((a,b)=>b.amount-a.amount);
  },[report,type,owner,search]);
  const owners=[...new Set((report?.rows||[]).map(r=>r.owner))].sort();
  const groups=[...new Set(rows.map(r=>r.salesOwner))].map(owner=>({owner,rows:rows.filter(r=>r.salesOwner===owner)}));
  useExcelExport(()=>report&&!loading&&!error?[
    excelTable('시트 날짜 기준 확인 입금',['원본 행','시트 날짜(A열)','업체','담당자','신규·기존','프로젝트','확인율(H열)','VAT 포함 계약액(원)','현재 확인 입금액(원)'],sourceRows.map(r=>[r.sourceRow,r.date,r.company,r.owner,r.ctype,r.program,r.percent==null?'금액 명시':r.percent+'%',r.contractAmount,r.amount]),`${periodLabel} · A열 월 귀속 / H열 현재 확인 / O열 VAT 규칙 · 실제 입금일 아님 · ${report.fetchedAt} · ${report.sourceHash}`),
    excelTable('확인 필요',['원본 행','시트 날짜','사유'],report.issues.map(r=>[r.sourceRow,r.date,r.code]),'확인되지 않은 금액은 합계에서 제외; 미지급 0원으로 판정한 것이 아님')
  ]:[]);
  return <section className="rounded-lg border border-slate-200 bg-white" aria-label="시트 날짜 기준 확인 입금">
    <div className="space-y-3 border-b border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">시트 날짜 기준 · 담당자별 확인 입금</h2><p className="mt-1 text-xs text-slate-600">프리미팅 일정·DB 등록 여부 무관 · A열 날짜 / H열 현재 지급 확인 / O열 별도가(VAT 규칙 적용)</p></div><button type="button" disabled={loading} onClick={()=>setReload(n=>n+1)} className="rounded border px-3 py-2 text-xs">{loading?'원본 조회 중…':'시트 다시 조회'}</button></div>
      <p role="note" className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">A열은 시트에 적힌 날짜입니다. 실제 입금일이나 해당 월 말의 입금액이 아니라, 그 날짜의 계약에 대한 현재 누적 확인액입니다. H열 체크=100%, 백분율=누적 수령률이며 I열 업로드 체크는 사용하지 않습니다.</p>
      <div className="flex flex-wrap items-center gap-2"><div role="group" aria-label="시트 고객 구분" className="flex gap-1">{['전체','신규','기존','미확인'].map(t=><button key={t} type="button" aria-pressed={type===t} onClick={()=>setType(t)} className={'rounded px-3 py-2 text-xs '+(type===t?'bg-slate-900 text-white':'bg-slate-100 text-slate-700')}>{t}</button>)}</div><input aria-label="시트 업체·담당자·프로젝트 검색" value={search} onChange={e=>setSearch(e.target.value)} placeholder="업체·담당자·프로젝트 검색" className="rounded border px-3 py-2 text-xs"/><select aria-label="시트 담당자" value={owner} onChange={e=>setOwner(e.target.value)} className="rounded border px-3 py-2 text-xs"><option>전체</option>{owners.map(o=><option key={o}>{o}</option>)}</select><div role="group" aria-label="시트 성과 보기" className="flex gap-1">{[['owner','담당자별'],['list','원본 행별']].map(([v,label])=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)} className={'rounded px-3 py-2 text-xs '+(view===v?'bg-indigo-600 text-white':'bg-slate-100 text-slate-700')}>{label}</button>)}</div></div>
      {loading?<p role="status" className="text-sm">시트 원본을 읽고 있습니다.</p>:error?<p role="alert" className="text-sm text-red-700">시트 검증 불가 · {error} · DB 3건으로 대체하거나 정상 0건으로 표시하지 않습니다.</p>:report&&<>
        <p className="text-sm">{periodLabel} · {rows.length}개 기업·담당 그룹 · 원본 {sourceRows.length}행 · 현재 확인 입금액 <strong>{money(sourceRows.reduce((s,r)=>s+r.amount,0))}</strong></p>
        <p className="break-all text-xs text-slate-500">원본 {new Date(report.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST · SHA-256 {report.sourceHash}</p>
        {!!report.issues.length&&<details className="rounded bg-amber-50 p-3 text-xs text-amber-900"><summary>확인 필요 {report.issues.length}행 · 합계 제외(기간 전체)</summary>{report.issues.map(i=><p key={i.sourceRow}>원본 {i.sourceRow}행 · {i.date} · {i.code}</p>)}</details>}
      </>}
    </div>
    {report&&!loading&&!error&&(view==='owner'?<ContractOwnerSheet groups={groups} title={periodLabel} customerType={type} valueOf={r=>r.amount} channelOf={()=>'—'} gradeOf={()=>'—'} programOf={r=>[...new Set(r.programs)].join(' · ')} onOpen={id=>{const r=rows.find(r=>r.id===id);if(r){setSearch(r.company);setView('list');}}} description="시트 A열 날짜 기준 · H열 현재 누적 확인액 · 프리미팅 무관 · 실제 입금일 아님 · 업체 클릭 시 원본 행별 근거" amountLabel="현재 확인 입금액" listLabel="기업·담당 그룹" dateOf={r=>[...new Set(r.dates)].join(' · ')} />:<div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-slate-100"><tr>{['원본 행','시트 날짜','업체','담당자','구분','프로젝트','확인율','현재 확인 입금액'].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{sourceRows.map(r=><tr key={r.sourceRow} className="border-t"><td className="p-3">{r.sourceRow}</td><td>{r.date}</td><td>{r.company}</td><td>{r.owner}</td><td>{r.ctype}</td><td>{r.program}</td><td>{r.percent==null?'금액 명시':r.percent+'%'}</td><td className="p-3 text-right font-bold">{money(r.amount)}</td></tr>)}</tbody></table>{!sourceRows.length&&<p className="p-6 text-sm">조건에 맞는 확인 입금 행이 없습니다.</p>}</div>)}
  </section>;
}
