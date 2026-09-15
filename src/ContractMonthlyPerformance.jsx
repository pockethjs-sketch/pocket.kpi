import React, {useEffect,useMemo,useState} from 'react';
import ContractOwnerSheet from './ContractOwnerSheet.jsx';
import {buildMonthlyPerformance,historyMoney,monthDifference} from './contract-performance.mjs';
const fetchHistory=()=>window.crmFetchContractHistory();
const emptyHistory={months:[],owners:[],details:[]};
export default function ContractMonthlyPerformance({leads,period,customerType,valueOf,openLead,loadHistory=fetchHistory}){
  const [history,setHistory]=useState(emptyHistory),[status,setStatus]=useState('loading');
  const [retry,setRetry]=useState(0),[year,setYear]=useState(String(period.y));
  const [metric,setMetric]=useState('amount'),[selected,setSelected]=useState('');
  useEffect(()=>{let active=true;setStatus('loading');
    loadHistory().then(data=>{
      if(!data.ok || !Array.isArray(data.months) || !Array.isArray(data.owners) || !Array.isArray(data.details)) throw new Error('invalid_history');
      if(active){setHistory(data);setStatus('ready');}
    }).catch(()=>{if(active)setStatus('error');});
    return()=>{active=false;};
  },[retry,loadHistory]);
  useEffect(()=>{setYear(String(period.y));setSelected('');},[period.y]);
  const all=useMemo(()=>buildMonthlyPerformance(leads,history,customerType,valueOf),[leads,history,customerType,valueOf]);
  const years=[...new Set(all.map(m=>m.month.slice(0,4)))].sort().reverse();
  const months=all.filter(m=>year==='all'||m.month.startsWith(year));
  const owners=[...new Set(months.flatMap(m=>Object.keys(m.owners)))].sort((a,b)=>{
    const total=owner=>months.reduce((s,m)=>s+(m.owners[owner]?.amount||0),0);
    return total(b)-total(a)||a.localeCompare(b,'ko');
  });
  const detail=all.find(m=>m.month===selected);
  const format=value=>metric==='amount'?historyMoney(value):value===null||value===undefined?'—':value+'건';
  const groups=detail?[...new Set(detail.rows.map(r=>detail.source==='sheet'?r.owner:r.salesOwner||'미배정'))].map(owner=>({owner,rows:detail.rows.filter(r=>(detail.source==='sheet'?r.owner:r.salesOwner||'미배정')===owner).map(r=>detail.source==='sheet'?{
    id:r.source_cell,company:r.company,channel:r.channel,grade:r.grade,buildup:r.program,contractAmount:r.contract_amount,ctype:r.customer_type||'구분 미상',sourceRange:r.source_range,
  }:r)})):[];
  return <section className="contract-monthly" aria-label="월별 계약 성과 비교">
    <div className="contract-monthly-toolbar">
      <div><h2>월별 계약 성과</h2><p>담당자별로 월간 흐름을 비교하고, 월을 누르면 계약 업체를 확인합니다.</p></div>
      <div className="flex gap-2 items-center flex-wrap">
        {history.months[0]?.source_id&&<a className="text-xs text-blue-700 underline" href={`https://docs.google.com/spreadsheets/d/${history.months[0].source_id}/edit#gid=91560401`} target="_blank" rel="noreferrer">원본 시트</a>}
        <label>비교 연도 <select aria-label="비교 연도" value={year} onChange={e=>{setYear(e.target.value);setSelected('');}}>
          <option value="all">모든 연도</option>{[...new Set([String(period.y),...years])].sort().reverse().map(y=><option key={y} value={y}>{y}년</option>)}
        </select></label>
        <div role="group" aria-label="비교 지표">{[['amount','계약액'],['count','계약 수']].map(([key,label])=><button key={key} type="button" aria-pressed={metric===key} onClick={()=>setMetric(key)}>{label}</button>)}</div>
      </div>
    </div>
    <div className="contract-monthly-note">
      {history.months[0]?.imported_at&&<>과거 자료 가져온 날짜: {new Date(history.months[0].imported_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})} · 자동 갱신 자료가 아닌 보관 실적입니다.<br/></>}
      과거 실적: 시트에 값이 있는 월을 우선 사용 · 같은 월의 CRM과 중복 합산하지 않음 · 신규/기존 구분이 없는 과거 월은 ‘—’ 표시
      <br/>계약액: 추가계약 포함 합계(없는 월은 월별성과의 기재액). 계약 수: 월 합계는 시트 기재 건수, 담당자별은 확인 가능한 업체 행 수입니다.
    </div>
    {status==='loading'&&<p role="status" className="p-4 text-sm">과거 계약 실적을 DB에서 불러오는 중…</p>}
    {status==='error'&&<p role="alert" className="p-4 text-sm text-red-700">과거 실적 조회 실패. 아래 CRM 자료만으로 전체 실적을 판단하지 마세요. <button type="button" onClick={()=>setRetry(n=>n+1)} className="underline">다시 조회</button></p>}
    {status==='ready'&&history.months.length===0&&<p role="status" className="p-4 text-sm">아직 가져온 과거 실적이 없습니다.</p>}
    <div className="contract-monthly-scroll" tabIndex={0} role="region" aria-label="월별 계약 비교 표, 좌우로 스크롤 가능">
      <table><caption className="sr-only">월별 {customerType} 계약 성과 · {metric==='amount'?'계약액':'계약 수'}</caption>
        <thead><tr><th scope="col">계약 월</th><th scope="col">월 합계</th><th scope="col">전월 대비</th>{owners.map(owner=><th scope="col" key={owner}>{owner}</th>)}<th scope="col">원본·확인 범위</th></tr></thead>
        <tbody>{months.map(m=>{
          const diff=monthDifference(m,all[all.indexOf(m)-1],metric);
          return <tr key={m.month} className={selected===m.month?'is-selected':''}>
            <th scope="row"><button type="button" aria-expanded={selected===m.month} onClick={()=>setSelected(selected===m.month?'':m.month)}>{m.month} {m.month===new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,7)&&<small>진행 중</small>}</button></th>
            <td className="monthly-total">{format(m[metric])}</td>
            <td className={diff>0?'monthly-up':diff<0?'monthly-down':''}>{diff===null?'—':(diff>0?'+':'')+diff.toFixed(1)+'%'}</td>
            {owners.map(owner=><td key={owner}>{m.hasDetails&&!m.unavailable?format(m.owners[owner]?.[metric]??0):'—'}</td>)}
            <td className="monthly-source">{m.source==='sheet'?<><span>시트 · {m.hasDetails?`상세 ${m.allRows.length}행`:'합계만 있음'}</span>{m.unavailable&&<small>신규/기존 구분 없음</small>}{metric==='count'&&m.hasDetails&&m.count!==m.allRows.length&&<small>기재 건수와 상세 행 수 다름</small>}{m.record.list_total_amount===null&&<small>추가계약 포함 여부 미확인</small>}</>:<span>현재 CRM</span>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!months.length&&<p className="p-8 text-center text-sm">해당 연도에 확인된 계약 자료가 없습니다.</p>}
    </div>
    {detail&&<div className="contract-monthly-detail">
      <div className="contract-monthly-toolbar"><div><h3>{detail.month} · {customerType} 계약 상세</h3>
        {detail.source==='sheet'&&<p>시트 기재 {detail.record.reported_count}건 / 상세 {detail.allRows.length}행 · 월별성과 {historyMoney(detail.record.reported_amount)} · 추가계약 포함 {historyMoney(detail.record.list_total_amount)}</p>}
      </div><button type="button" onClick={()=>setSelected('')}>상세 닫기</button></div>
      {detail.source==='sheet'&&<p className="contract-monthly-note">과거 실적 전용 · 실제 계약일·입금·신규/기존은 추정하지 않았습니다. 업체명을 누르면 원본 셀로 이동합니다.{detail.overlapCount>0?` 기존 CRM ${detail.overlapCount}건은 보존하되 이 월 실적에는 더하지 않았습니다.`:''}</p>}
      {!detail.hasDetails?<p className="p-6 text-sm">이 월은 시트에 월 합계만 있습니다. 담당자·업체별 자료는 없어 표시하지 않습니다.</p>:
        detail.unavailable?<p className="p-6 text-sm">원본에 신규/기존 구분이 없습니다. ‘전체’를 선택하면 원본 업체를 확인할 수 있습니다.</p>:
        <ContractOwnerSheet groups={groups} title={detail.month} customerType={customerType}
          valueOf={l=>detail.source==='sheet'?Number(l.contractAmount||0):valueOf(l)} channelOf={v=>v||'—'} gradeOf={v=>v||'—'} programOf={l=>l.buildup||'—'}
          description={detail.source==='sheet'?'원본 월 기준 · 업체 행 합계 · 업체명 클릭 시 원본 셀':'계약일 기준 · 현재 CRM · 업체명 클릭 시 상세'}
          onOpen={id=>{if(detail.source==='crm')openLead(id);else {const row=detail.rows.find(r=>r.source_cell===id);window.open(`https://docs.google.com/spreadsheets/d/${detail.record.source_id}/edit#gid=220763865&range=${encodeURIComponent(row.source_cell)}`,'_blank','noopener,noreferrer');}}} />}
    </div>}
  </section>;
}
