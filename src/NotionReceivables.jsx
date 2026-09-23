import React, { useEffect, useMemo, useState } from 'react';
import { filterNotionReceivables, notionReceivableSummary, notionSourceUrl } from './data/notionReceivables.js';

const display = (value) => String(value || '').trim() || '—';
const formatTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '확인 불가';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

export default function NotionReceivables() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [latestImportedAt, setLatestImportedAt] = useState('');
  const [query, setQuery] = useState('');
  const [requestStatus, setRequestStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');

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
  const summary = useMemo(() => notionReceivableSummary(rows), [rows]);
  const visible = useMemo(() => filterNotionReceivables(rows, { query, requestStatus, paymentStatus }), [rows, query, requestStatus, paymentStatus]);
  const requestOptions = [...new Set(rows.map((row) => row.request_status).filter(Boolean))].sort();
  const paymentOptions = [...new Set(rows.map((row) => row.payment_status).filter(Boolean))].sort();

  return <section className="rounded-md border border-slate-200 bg-white shadow-sm" aria-label="노션 선잔금 이관 자료">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4">
      <div>
        <h2 className="text-sm font-black text-slate-900">노션 선잔금·미납 이관 자료 <span className="text-indigo-700">{summary.count}건</span></h2>
        <p className="mt-1 text-[11px] text-slate-500">Supabase에 저장된 노션 원본입니다. 기존 잔금 원장·계약액·수금·미수 합계에는 자동 반영하지 않습니다.</p>
        <p className="mt-1 text-[10px] text-slate-400">마지막 DB 반영 {formatTime(latestImportedAt)} · 요청 상태의 ‘완료’는 입금 완료를 뜻하지 않습니다.</p>
      </div>
      <button type="button" onClick={reload} disabled={status === 'loading'} className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{status === 'loading' ? '조회 중…' : '새로고침'}</button>
    </div>
    {status === 'error' && <div role="alert" className="m-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold text-rose-700">노션 이관 자료 조회 실패 · {error}. {rows.length ? '마지막 조회 결과를 유지합니다.' : '잔금 원장 데이터에는 영향이 없습니다.'}</div>}
    {status === 'loading' && !rows.length && <p className="p-8 text-center text-xs text-slate-500">Supabase 자료를 읽는 중입니다.</p>}
    {(status !== 'loading' || rows.length > 0) && <>
      <div className="grid gap-2 border-b border-slate-100 p-3 md:grid-cols-[minmax(220px,1fr)_160px_160px]">
        <input aria-label="이관 자료 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체·프로젝트·담당·메모 검색" className="h-9 rounded-md border border-slate-200 px-3 text-xs" />
        <select aria-label="요청 상태 필터" value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs"><option value="">모든 요청 상태</option>{requestOptions.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="입금 상태 필터" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 px-2 text-xs"><option value="">모든 입금 상태</option>{paymentOptions.map((value) => <option key={value}>{value}</option>)}</select>
      </div>
      <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-2 text-[10px] text-slate-500"><span>표시 <b className="text-slate-900">{visible.length}</b> / {summary.count}건</span><span>요청 완료·입금전 <b className="text-amber-700">{summary.requestDonePaymentOpen}건</b></span>{summary.missingCompany > 0 && <span>업체명 미입력 {summary.missingCompany}건</span>}</div>
      <div className="overflow-x-auto"><table className="min-w-[1200px] w-full text-left text-[11px]"><thead className="bg-slate-50 text-slate-500"><tr>{['업체', '계약진행일', '프리', '프로젝트', '선금 원문', '잔금 원문', '요청 상태', '입금 상태', '특이사항', '원본'].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-3 py-2 font-extrabold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row) => <tr key={row.source_key} className="align-top hover:bg-slate-50"><td className="min-w-[150px] px-3 py-2 font-bold text-slate-800">{display(row.company)}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{display(row.contract_date)}</td><td className="px-3 py-2">{display(row.freelancer)}</td><td className="min-w-[130px] whitespace-pre-line px-3 py-2">{display(row.projects_text)}</td><td className="min-w-[160px] whitespace-pre-line px-3 py-2">{display(row.deposit_text)}</td><td className="min-w-[160px] whitespace-pre-line px-3 py-2">{display(row.balance_text)}</td><td className="whitespace-nowrap px-3 py-2">{display(row.request_status)}</td><td className="whitespace-nowrap px-3 py-2">{display(row.payment_status)}</td><td className="min-w-[220px] max-w-[300px] whitespace-pre-line break-words px-3 py-2 text-slate-600">{display(row.notes)}</td><td className="whitespace-nowrap px-3 py-2">{notionSourceUrl(row.source_page_reference) ? <a href={notionSourceUrl(row.source_page_reference)} target="_blank" rel="noopener noreferrer" className="font-bold text-indigo-700 underline">노션 열기</a> : '—'}</td></tr>)}</tbody></table>{!visible.length && <p className="p-8 text-center text-xs text-slate-400">표시할 이관 자료가 없습니다.</p>}</div>
    </>}
  </section>;
}
