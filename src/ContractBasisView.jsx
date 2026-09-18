import React, { useEffect, useMemo, useState } from 'react';
import ContractOwnerSheet, { ContractCustomerTypeLabel } from './ContractOwnerSheet.jsx';
import { contractAmount, contractBasisEvents, summarizeContractBasis } from './data/contractBasis.js';

const money = amount => '₩' + Number(amount || 0).toLocaleString('ko-KR');
const ownerOf = lead => lead.salesOwner || '미배정';
const valueOf = lead => lead.basisAmount;
const dateOf = lead => lead.basisDate;
const programOf = lead => [...new Set([lead.buildup, ...(lead.buildups || []), ...(lead.lineItems || []).map(item => item.buildup || item.name)].filter(Boolean))].join(' · ') || '미지정';

export default function ContractBasisView({ leads, basis, range, periodLabel, openLead, channelOf }) {
  const [type, setType] = useState('전체');
  const [view, setView] = useState('owner');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('전체');
  const [month, setMonth] = useState('');
  useEffect(() => { setOwner('전체'); setMonth(''); }, [basis, range?.[0], range?.[1], type]);
  const isPayment = basis === 'payment';
  const basisLabel = isPayment ? '입금 시점 기준' : '미팅 일자 기준';
  const amountLabel = isPayment ? '기간 입금액' : '계약액';
  const listLabel = isPayment ? '입금 기업' : '계약';
  const effectiveRange = view === 'monthly' && month ? [month + '-01', month + '-31'] : range;
  const summary = useMemo(() => summarizeContractBasis(leads, basis, effectiveRange, type), [leads, basis, effectiveRange?.[0], effectiveRange?.[1], type]);
  const ownerRows = view === 'monthly' ? summarizeContractBasis(leads, basis, null, type).rows : summary.rows;
  const owners = [...new Set(ownerRows.map(ownerOf))].sort((a, b) => a.localeCompare(b, 'ko'));
  const matches = lead => (owner === '전체' || ownerOf(lead) === owner) && (!search.trim() || [lead.company, ownerOf(lead), lead.channel, programOf(lead)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const rows = summary.rows.filter(matches);
  const groups = owners.map(name => ({ owner: name, rows: rows.filter(row => ownerOf(row) === name) })).filter(group => group.rows.length)
    .sort((a, b) => b.rows.reduce((s, row) => s + row.basisAmount, 0) - a.rows.reduce((s, row) => s + row.basisAmount, 0));
  const events = rows.flatMap(row => row.basisEvents);
  const months = useMemo(() => {
    const eligible = leads.filter(lead => (type === '전체' || (lead.ctype || '신규') === type) && matches(lead));
    const all = contractBasisEvents(eligible, basis).events;
    return [...new Set(all.map(event => event.date.slice(0, 7)))].sort().reverse().map(key => {
      const selected = all.filter(event => event.date.startsWith(key));
      return { month: key, count: new Set(selected.map(event => event.lead.id)).size, events: selected.length, amount: selected.reduce((sum, event) => sum + event.amount, 0) };
    });
  }, [leads, basis, type, owner, search]);
  const description = isPayment
    ? '실제 입금일 기준 · 해당 기간 받은 선금·중도금·잔금만 합산 · 계약 총액 아님'
    : '최초 CRM 프리미팅일(없으면 저장된 프리미팅일) 기준 · 현재 확정 계약액 · 계약일 원본 유지';
  return <section className="rounded-lg border border-slate-200 bg-white" aria-label={basisLabel + ' 계약 성과'}>
    <div className="space-y-3 border-b border-slate-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-extrabold text-slate-900">{basisLabel} · 담당자별 성과</h2><p className="mt-1 text-[11px] text-slate-500">{description}</p></div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="계약 고객 구분" className="flex gap-1">{['전체', '신규', '기존'].map(item => <button key={item} aria-pressed={type === item} onClick={() => setType(item)} className={'rounded-md px-3 py-1.5 text-xs font-bold ' + (type === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>{item}</button>)}</div>
          <input aria-label="업체·채널·프로그램 검색" placeholder="업체·채널·프로그램 검색" value={search} onChange={event => setSearch(event.target.value)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs" />
          <select aria-label="담당자" value={owner} onChange={event => setOwner(event.target.value)} className="rounded-md border border-slate-200 px-2 text-xs"><option>전체</option>{owners.map(name => <option key={name}>{name}</option>)}</select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="성과 보기" className="flex gap-1">{[['owner', '담당자별'], ['list', '전체 목록'], ['monthly', '월별 비교']].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setMonth(''); }} className={'rounded-md px-3 py-1.5 text-xs font-bold ' + (view === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600')}>{label}</button>)}</div>
        <p className="text-xs text-slate-600">{view === 'monthly' && month ? month : periodLabel} · {rows.length}개사 {isPayment && `· ${events.length}회 입금`} · <b className="text-indigo-700">{amountLabel} {money(rows.reduce((sum, row) => sum + row.basisAmount, 0))}</b></p>
      </div>
      {!!summary.undated.length && <details className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><summary className="cursor-pointer font-bold">{isPayment ? '입금일' : '미팅일'} 미상 {summary.undated.length}건 · 전체 기간 · 월별 집계 제외</summary>
        <p className="mt-1">{isPayment ? '완료 체크만 있거나 날짜가 없는 금액은 계약일·예정일로 대신 집계하지 않습니다.' : '미팅 날짜가 없는 계약을 계약일·유입일로 대신 집계하지 않습니다.'}</p>
        <div className="mt-2 max-h-44 overflow-y-auto">{summary.undated.map((event, index) => <button key={event.lead.id + ':' + index} onClick={() => openLead(event.lead.id)} className="block py-1 text-left underline">{event.lead.company} · {event.lead.ctype || '신규'} · {money(event.amount)}</button>)}</div>
      </details>}
    </div>
    {view === 'monthly' && <div className="p-4">
      <p className="mb-3 text-[11px] text-slate-500">저장된 날짜가 있는 전체 월 비교 · 월을 누르면 아래에 담당자별 상세 표시. 과거 시트의 월 합계는 미팅일/입금일 근거가 없어 섞지 않습니다.</p>
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="bg-slate-100"><th className="p-2">귀속 월</th><th>업체 수</th>{isPayment && <th>입금 회차</th>}<th className="text-right p-2">{amountLabel}</th></tr></thead><tbody>{months.map(row => <tr key={row.month} className={month === row.month ? 'bg-indigo-50' : 'border-b border-slate-100'}><td className="p-2"><button onClick={() => setMonth(row.month)} className="font-bold text-indigo-700 underline">{row.month}</button></td><td>{row.count}개사</td>{isPayment && <td>{row.events}회</td>}<td className="p-2 text-right font-bold">{money(row.amount)}</td></tr>)}</tbody></table>{!months.length && <p className="p-6 text-center text-xs text-slate-400">확인된 날짜별 실적이 없습니다.</p>}</div>
    </div>}
    {view !== 'list' ? <ContractOwnerSheet groups={groups} title={view === 'monthly' && month ? month : periodLabel} customerType={type} valueOf={valueOf} channelOf={channelOf} gradeOf={value => value || '미평가'} programOf={programOf} onOpen={openLead} description={description} amountLabel={amountLabel} listLabel={listLabel} dateOf={dateOf} />
      : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr className="bg-slate-50 text-slate-500"><th className="p-3">{isPayment ? '입금일·회차' : '미팅일'}</th><th>업체·구분</th><th>담당자</th><th>프로그램</th><th className="p-3 text-right">{amountLabel}</th>{isPayment && <th className="p-3 text-right">참고 계약 총액</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100"><td className="p-3">{row.basisEvents.map((event, index) => <p key={index}>{event.date}{isPayment && ` · ${event.payment?.label || '입금'} ${money(event.amount)}`}</p>)}</td><td><button onClick={() => openLead(row.id)} className="font-bold text-indigo-700 underline">{row.company}</button> <ContractCustomerTypeLabel value={row.ctype} /></td><td>{ownerOf(row)}</td><td>{programOf(row)}</td><td className="p-3 text-right font-bold">{money(row.basisAmount)}</td>{isPayment && <td className="p-3 text-right text-slate-400">{money(contractAmount(row))}</td>}</tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-400">조건에 맞는 실적이 없습니다.</p>}</div>}
  </section>;
}
