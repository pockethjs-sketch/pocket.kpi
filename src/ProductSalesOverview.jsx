import React, { useEffect, useMemo, useState } from 'react';
import { summarizeProductSales } from './data/productSales.js';

const count = value => Number(value).toLocaleString('ko-KR');
const won = value => '₩' + count(value);
const cell = 'px-4 py-3 text-left whitespace-nowrap';

export default function ProductSalesOverview({ leads = [], products = [], range, periodLabel, openLead }) {
  const [type, setType] = useState('전체'), [selected, setSelected] = useState('전체'), [limit, setLimit] = useState(30);
  const summary = useMemo(() => summarizeProductSales(leads, products, range, type), [leads, products, range?.[0], range?.[1], type]);
  useEffect(() => { setSelected('전체'); setLimit(30); }, [range?.[0], range?.[1], type]);
  const selectedGroup = summary.groups.find(group => group.name === selected);
  const rows = selected === '계약일 미확인' ? summary.undated : selected === '금액 미확인' ? summary.missingAmount : selectedGroup?.rows || summary.rows;
  const select = name => { setSelected(name); setLimit(30); };
  const max = Math.max(1, ...summary.groups.map(group => group.count));
  return <section aria-label="빌드업 판매 현황" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-extrabold text-slate-900">빌드업별 판매 현황</h2><p className="mt-1 text-sm text-slate-500">{periodLabel} · 계약일 기준 · 계약 완료 및 금액이 있는 기록</p></div>
      <div className="flex rounded-md border border-slate-200 bg-white p-1" aria-label="고객 구분">{['전체','신규','기존'].map(value => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)} className={'rounded px-4 py-2 text-sm font-semibold ' + (type === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>{value}</button>)}</div>
    </div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {[['판매 계약', count(summary.total) + '건', '업체 기록당 1건 · 중복 제거'], ['전체 계약금액', won(summary.amount), '실제 입금액과 다름 · 중복 합산 없음'], ['복수 빌드업 계약', count(summary.multiple) + '건', '각 빌드업에 1건씩 포함'], ['빌드업 미분류', count(summary.unclassified) + '건', '선택 정보가 없거나 분류 확인 필요']].map(([label, value, note]) => <div key={label} className={'min-w-0 rounded-md border border-slate-200 bg-white p-4 ' + (['판매 계약', '전체 계약금액'].includes(label) ? 'col-span-2 sm:col-span-1' : '')}><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 break-words text-xl sm:text-2xl font-extrabold tabular-nums text-slate-900">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p></div>)}
    </div>
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full min-w-[600px] text-sm"><caption className="sr-only">빌드업 판매 계약 수 · 빌드업명을 누르면 해당 계약을 확인합니다.</caption><thead className="bg-slate-50 text-slate-500"><tr>{['빌드업','판매 계약','신규','기존','미구분','판매량 비교'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{summary.groups.map(group => <tr key={group.name} className={selected === group.name ? 'bg-indigo-50' : 'hover:bg-slate-50'}><th scope="row" className={cell}><button type="button" aria-pressed={selected === group.name} onClick={() => select(group.name)} className="text-left font-bold text-indigo-700 underline decoration-indigo-200 underline-offset-4">{group.name}</button></th><td className={cell + ' text-xl font-extrabold tabular-nums text-slate-900'}>{count(group.count)}<span className="ml-1 text-xs font-normal">건</span></td><td className={cell}>{count(group.newCount)}</td><td className={cell}>{count(group.existingCount)}</td><td className={cell}>{count(group.otherCount)}</td><td className={cell}><div aria-hidden="true" className="h-2 min-w-24 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-indigo-500" style={{ width: (group.count / max * 100) + '%' }} /></div></td></tr>)}</tbody>
      </table>
    </div>
    <p className="text-xs leading-5 text-slate-500">계약 완료 기록에 저장된 빌드업·세부항목 기준입니다. 같은 빌드업은 한 계약에서 한 번만 세며, 복수 빌드업 때문에 행 합계는 전체 계약 수보다 클 수 있습니다. 회차·결제 횟수·수량은 판매 건수로 세지 않습니다. 별도 계약 이력은 중복 방지를 위해 추가 합산하지 않습니다.</p>
    {(summary.undated.length > 0 || summary.missingAmount.length > 0) && <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>집계 제외 확인</span><button type="button" onClick={() => select('계약일 미확인')} className="underline">계약일 미확인 {summary.undated.length}건 (전체 기간)</button><button type="button" onClick={() => select('금액 미확인')} className="underline">선택 기간 금액 미확인 {summary.missingAmount.length}건</button></div>}
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-900">{selected} · 계약 목록 <span className="text-indigo-600">{rows.length}건</span></h3>{selected !== '전체' && <button type="button" onClick={() => select('전체')} className="text-sm text-indigo-700 underline">전체 계약 보기</button>}</div>
      <p className="mb-3 text-xs text-slate-500">금액은 해당 계약의 전체 금액이며 빌드업별 배분 금액이 아닙니다. 업체명을 누르면 저장된 상세 정보를 확인합니다.</p>
      {!rows.length ? <p className="py-8 text-center text-sm text-slate-500">해당 조건의 계약이 없습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['계약일','업체','구분','영업담당','저장된 빌드업','계약 전체 금액'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, limit).map(row => <tr key={row.lead.id}><td className={cell + ' whitespace-nowrap'}>{row.date || '미확인'}</td><td className={cell}><button type="button" onClick={() => openLead?.(row.lead.id)} className="text-left font-bold text-indigo-700 underline underline-offset-4">{row.lead.company || '업체명 미입력'}</button></td><td className={cell}>{row.type}</td><td className={cell}>{row.lead.salesOwner || '미배정'}</td><td className={cell}><p>{row.groups.join(' · ')}</p>{row.unmapped.length > 0 && <p className="mt-1 text-xs text-amber-700">분류 확인: {row.unmapped.join(' · ')}</p>}</td><td className={cell + ' whitespace-nowrap font-semibold tabular-nums'}>{Number.isFinite(row.amount) ? won(row.amount) : '미확인'}</td></tr>)}</tbody></table></div>}
      {rows.length > limit && <button type="button" onClick={() => setLimit(limit + 30)} className="mt-3 rounded-md border border-slate-200 px-4 py-2 text-sm">30건 더 보기 ({Math.min(limit, rows.length)}/{rows.length})</button>}
    </div>
  </section>;
}
