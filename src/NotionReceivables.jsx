import React, { useEffect, useMemo, useState } from 'react';
import { filterNotionReceivables, NOTION_RECEIVABLE_STAGES, notionReceivableStage, notionReceivableStageCounts, notionReceivableSummary, notionSourceUrl } from './data/notionReceivables.js';

const PAGE_SIZE = 30;
const display = (value) => String(value ?? '').trim() || '—';
const stageTone = {
  requestBefore: 'border-slate-200 bg-slate-50 text-slate-700',
  requestOngoing: 'border-blue-200 bg-blue-50 text-blue-700',
  awaitingPayment: 'border-amber-200 bg-amber-50 text-amber-800',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-rose-200 bg-rose-50 text-rose-700',
};
const formatTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '확인 불가';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

function DetailField({ label, value }) {
  return <div className="min-w-0 border-b border-slate-100 py-2 last:border-0">
    <dt className="text-[10px] font-bold text-slate-400">{label}</dt>
    <dd className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-700">{display(value)}</dd>
  </div>;
}

export default function NotionReceivables() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [latestImportedAt, setLatestImportedAt] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [requestStatus, setRequestStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  async function reload() {
    setStatus('loading');
    setError('');
    try {
      const result = await window.crmFetchNotionReceivables();
      if (!result?.ok || !Array.isArray(result.rows) || result.count !== result.rows.length) throw new Error('invalid_response');
      setRows(result.rows);
      setLatestImportedAt(result.latestImportedAt || '');
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'read_failed');
      setStatus('error');
    }
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [stage, query, requestStatus, paymentStatus]);
  const summary = useMemo(() => notionReceivableSummary(rows), [rows]);
  const stageCounts = useMemo(() => notionReceivableStageCounts(rows), [rows]);
  const visible = useMemo(() => filterNotionReceivables(rows, { query, stage: stage === 'all' ? '' : stage, requestStatus, paymentStatus }), [rows, query, stage, requestStatus, paymentStatus]);
  const shown = visible.slice(0, visibleLimit);
  const requestOptions = [...new Set(rows.map((row) => row.request_status).filter(Boolean))].sort();
  const paymentOptions = [...new Set(rows.map((row) => row.payment_status).filter(Boolean))].sort();
  const stages = [{ id: 'all', label: '전체', count: summary.count }, ...NOTION_RECEIVABLE_STAGES.map((item) => ({ ...item, count: stageCounts[item.id] }))];
  const hasAdvancedFilters = !!requestStatus || !!paymentStatus;

  return <section className="rounded-md border border-slate-200 bg-white shadow-sm" aria-label="노션 선잔금 이관 자료">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4">
      <div>
        <h2 className="text-sm font-black text-slate-900">선잔금·미납 분류 <span className="text-indigo-700">{summary.count}건</span></h2>
        <p className="mt-1 text-[11px] text-slate-500">노션에서 이관한 자료를 상태별로 보는 읽기 전용 목록입니다. 운영 잔금 원장과 자동 합산·병합하지 않습니다.</p>
        <p className="mt-1 text-[10px] text-slate-400">마지막 DB 반영 {formatTime(latestImportedAt)} · 지급요청 완료는 입금 완료가 아닙니다.</p>
      </div>
      <button type="button" onClick={reload} disabled={status === 'loading'} className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{status === 'loading' ? '조회 중…' : '새로고침'}</button>
    </div>
    {status === 'error' && <div role="alert" className="m-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold text-rose-700">노션 이관 자료 조회 실패 · {error}. {rows.length ? '마지막 조회 결과를 유지합니다.' : '운영 잔금 원장에는 영향이 없습니다.'}</div>}
    {status === 'loading' && !rows.length && <p className="p-8 text-center text-xs text-slate-500">Supabase 자료를 읽는 중입니다.</p>}
    {(status !== 'loading' || rows.length > 0) && <>
      <div role="group" aria-label="노션 잔금 처리 단계" className="grid grid-cols-2 gap-2 border-b border-slate-100 p-3 md:grid-cols-3 xl:grid-cols-6">
        {stages.map((item) => <button key={item.id} type="button" aria-pressed={stage === item.id} onClick={() => setStage(item.id)} className={'rounded-md border px-3 py-2 text-left transition-colors ' + (stage === item.id ? 'border-indigo-400 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
          <span className="block text-[10px] font-bold">{item.label}</span><strong className="mt-1 block text-lg font-black tabular-nums">{item.count}<small className="ml-0.5 text-[10px]">건</small></strong>
        </button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input aria-label="이관 자료 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체·프로젝트·담당·메모 검색" className="h-9 min-w-[220px] flex-1 rounded-md border border-slate-200 px-3 text-xs" />
        <details className="relative group"><summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-slate-200 px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">세부 필터{hasAdvancedFilters ? ' 적용 중' : ''}</summary>
          <div className="absolute right-0 z-10 mt-1 flex w-[260px] flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
            <select aria-label="요청 상태 필터" value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs"><option value="">모든 요청 상태</option>{requestOptions.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="입금 상태 필터" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs"><option value="">모든 입금 상태</option>{paymentOptions.map((value) => <option key={value}>{value}</option>)}</select>
            {hasAdvancedFilters && <button type="button" onClick={() => { setRequestStatus(''); setPaymentStatus(''); }} className="text-left text-[11px] font-bold text-indigo-700">세부 필터 초기화</button>}
          </div>
        </details>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-[10px] text-slate-500"><span>검색 결과 <b className="text-slate-900">{visible.length}</b> / {summary.count}건</span><span>요청 완료·입금전 <b className="text-amber-700">{summary.requestDonePaymentOpen}건</b></span>{summary.missingCompany > 0 && <span>업체명 미입력 {summary.missingCompany}건</span>}</div>
      <div aria-hidden="true" className="hidden grid-cols-[minmax(160px,1.3fr)_110px_minmax(130px,1fr)_minmax(160px,1.4fr)_80px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-bold text-slate-500 md:grid"><span>업체</span><span>계약일</span><span>프로젝트</span><span>잔금 원문</span><span>단계</span></div>
      <ol className="divide-y divide-slate-100">
        {shown.map((row) => {
          const rowStage = notionReceivableStage(row);
          const stageLabel = NOTION_RECEIVABLE_STAGES.find((item) => item.id === rowStage)?.label || '상태 확인';
          const sourceUrl = notionSourceUrl(row.source_page_reference);
          return <li key={row.source_key}><details className="group">
            <summary className="grid cursor-pointer list-none gap-1.5 px-4 py-3 hover:bg-slate-50 md:grid-cols-[minmax(160px,1.3fr)_110px_minmax(130px,1fr)_minmax(160px,1.4fr)_80px] md:items-center md:gap-3 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate text-[12px] font-extrabold text-slate-900">{display(row.company)}</span>
              <span className="text-[10px] text-slate-500"><span className="md:hidden">계약일 · </span>{display(row.contract_date)}</span>
              <span className="min-w-0 truncate text-[10px] text-slate-600"><span className="md:hidden">프로젝트 · </span>{display(row.projects_text)}</span>
              <span className="min-w-0 truncate text-[10px] text-slate-500"><span className="md:hidden">잔금 · </span>{display(row.balance_text)}</span>
              <span className={'w-fit whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-extrabold ' + stageTone[rowStage]}>{stageLabel}</span>
            </summary>
            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
              <dl className="grid gap-x-5 md:grid-cols-2 xl:grid-cols-3">
                <DetailField label="프리 담당" value={row.freelancer} /><DetailField label="프로젝트" value={row.projects_text} /><DetailField label="계약진행일" value={row.contract_date} />
                <DetailField label="선금 원문" value={row.deposit_text} /><DetailField label="잔금 원문" value={row.balance_text} /><DetailField label="요청 / 입금 원문 상태" value={`${display(row.request_status)} / ${display(row.payment_status)}`} />
                <DetailField label="특이사항" value={row.notes} />
              </dl>
              {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="my-2 inline-block text-[11px] font-bold text-indigo-700 underline">노션 원본 열기</a>}
            </div>
          </details></li>;
        })}
      </ol>
      {!visible.length && <p className="p-8 text-center text-xs text-slate-400">조건에 맞는 이관 자료가 없습니다.</p>}
      {shown.length < visible.length && <div className="border-t border-slate-100 p-3 text-center"><button type="button" onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)} className="rounded-md border border-slate-200 px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50">더 보기 · 남은 {visible.length - shown.length}건</button></div>}
    </>}
  </section>;
}
