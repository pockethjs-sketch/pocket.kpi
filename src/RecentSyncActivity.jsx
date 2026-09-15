import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, ArrowRight } from 'lucide-react';
import { syncActivityRows, filterSyncActivity, syncChanges, formatSyncValue } from './data/syncActivity.mjs';

const timeLabel = row => row.time ? new Date(row.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 시각 없음';
const control = 'rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function RecentSyncActivity({ loadLogs, leads = [], openLead, reloadKey = '' }) {
  const [logs, setLogs] = useState([]), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState(''), [days, setDays] = useState('7'), [source, setSource] = useState('all'), [result, setResult] = useState('all'), [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const requestId = useRef(0);
  const refresh = async () => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const payload = await loadLogs();
      if (!Array.isArray(payload?.logs)) throw new Error('sync_logs_invalid');
      if (id !== requestId.current) return;
      setLogs(payload.logs); setLoaded(true); setCheckedAt(new Date().toISOString()); setError('');
    } catch (e) {
      if (id === requestId.current) setError('동기화 내역 조회 실패 · 마지막으로 확인한 목록은 유지됩니다.');
    } finally { if (id === requestId.current) setBusy(false); }
  };
  useEffect(() => { refresh(); return () => { requestId.current++; }; }, [loadLogs, reloadKey]);
  useEffect(() => setLimit(50), [days, source, result, query]);
  const rows = useMemo(() => syncActivityRows(logs), [logs]);
  const filtered = useMemo(() => filterSyncActivity(rows, { days, source, result, query, now: checkedAt || new Date().toISOString() }), [rows, days, source, result, query, checkedAt]);
  const leadById = useMemo(() => new Map(leads.map(l => [String(l.id), l])), [leads]);
  const companies = new Set(filtered.map(row => String(row.leadId))).size;

  return <section aria-label="최근 동기화 내역" className="space-y-3">
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-extrabold text-slate-900">자동 반영된 업체</h2><p className="mt-1 text-xs leading-5 text-slate-500">CRM·계약 시트에서 실제 저장된 추가·수정만 표시합니다. 버튼으로 실행한 자동 반영도 포함하며, 조회만 한 건·보류·직접 입력은 제외합니다.</p></div>
        <button type="button" disabled={busy} onClick={refresh} className={control + ' flex shrink-0 items-center gap-1.5 disabled:opacity-50'}><RefreshCw size={13} className={busy ? 'animate-spin' : ''}/>{busy ? '조회 중…' : '내역 새로고침'}</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label="동기화 기간" value={days} onChange={e => setDays(e.target.value)} className={control}><option value="1">오늘</option><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="all">전체 기록</option></select>
        <select aria-label="동기화 출처" value={source} onChange={e => setSource(e.target.value)} className={control}><option value="all">출처 전체</option><option value="crm">CRM 프리미팅</option><option value="sheet">계약 시트</option></select>
        <select aria-label="반영 구분" value={result} onChange={e => setResult(e.target.value)} className={control}><option value="all">추가·수정 전체</option><option value="created">기업 생성</option><option value="updated">정보 수정</option><option value="unknown">구분 기록 없음</option></select>
        <label className="relative min-w-[180px] flex-1"><span className="sr-only">동기화 업체 검색</span><Search size={13} className="absolute left-2.5 top-2.5 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="업체명·변경 내용 검색" className={control + ' w-full pl-8'}/></label>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs"><p className="font-semibold text-slate-700">{companies}개 업체 · 반영 {filtered.length}건 <span className="font-normal text-slate-400">(같은 업체의 여러 변경은 각각 표시)</span></p><span className="text-slate-400">{checkedAt ? '목록 확인 ' + new Date(checkedAt).toLocaleTimeString('ko-KR', { timeZone:'Asia/Seoul' }) : '저장된 이력 확인 중'}</span></div>
      {error && <p role="alert" className="mt-3 text-xs font-semibold text-red-600">{error}</p>}
    </div>
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr><th className="w-40 px-3 py-3">반영 시각 · 한국시간</th><th className="w-44 px-3 py-3">업체</th><th className="w-32 px-3 py-3">출처 / 구분</th><th className="px-3 py-3">반영 내용</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{filtered.slice(0, limit).map((row, index) => {
          const lead = leadById.get(String(row.leadId)), changes = syncChanges(row);
          const canOpen = lead && !lead.archivedAt && !lead.archived_at;
          return <tr key={row.id || `${row.leadId}-${row.at}-${index}`} className="align-top hover:bg-slate-50/60">
            <td className="px-3 py-3 leading-5 tabular-nums text-slate-500">{timeLabel(row)}</td>
            <td className="px-3 py-3"><button type="button" disabled={!canOpen} onClick={() => openLead(lead.id)} className="text-left font-bold leading-5 text-indigo-700 hover:underline disabled:text-slate-500 disabled:no-underline">{row.company || '(업체명 미기록)'}</button>{lead?.company && lead.company !== row.company && <p className="mt-1 text-[10px] text-slate-400">현재명: {lead.company}</p>}{!canOpen && <p className="mt-1 text-[10px] text-slate-400">삭제·보관 또는 현재 목록에 없음</p>}</td>
            <td className="px-3 py-3"><p className="font-semibold text-slate-700">{row.sourceType === 'sheet' ? '계약 시트' : 'CRM 프리미팅'}</p><span className={'mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] ' + (row.resultType === 'created' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700')}>{row.resultType === 'created' ? '기업 생성' : row.resultType === 'updated' ? '정보 수정' : '구분 기록 없음'}</span></td>
            <td className="px-3 py-3 leading-5 text-slate-600"><p>{row.detail || row.action}</p>{changes.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-semibold text-indigo-600">변경 전·후 {changes.length}개 항목</summary><dl className="mt-2 space-y-2 border-l-2 border-indigo-100 pl-3">{changes.map(change => <div key={change.key}><dt className="font-bold text-slate-700">{change.label}</dt><dd className="mt-0.5 flex flex-wrap items-start gap-2"><span className="max-w-full whitespace-pre-wrap break-words text-slate-400">{formatSyncValue(change.key, change.before)}</span><ArrowRight aria-label="변경 후" size={12} className="mt-1 shrink-0 text-slate-400"/><span className="max-w-full whitespace-pre-wrap break-words font-medium text-slate-800">{formatSyncValue(change.key, change.after)}</span></dd></div>)}</dl></details>}{!changes.length && <p className="mt-1 text-[10px] text-slate-400">항목별 전후값이 없는 과거 로그는 저장된 설명만 표시합니다.</p>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!filtered.length && <p className="px-4 py-12 text-center text-xs text-slate-400">{busy && !loaded ? '저장된 동기화 내역을 확인하고 있습니다.' : !loaded && error ? '목록을 확인하지 못했습니다. 내역 새로고침으로 다시 조회해주세요.' : '조건에 맞는 자동 반영 내역이 없습니다. 변경 없이 확인한 동기화는 이 목록에 남지 않습니다.'}</p>}
      {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + 50)} className="w-full border-t border-slate-100 py-3 text-xs font-bold text-indigo-600">50건 더 보기 ({Math.min(limit, filtered.length)} / {filtered.length})</button>}
    </div>
    <p className="text-[11px] leading-5 text-slate-400">Supabase에 저장된 활동 로그 기준 · 상단 미팅월이 아닌 실제 반영 시각으로 필터합니다. 과거에 기록하지 않은 변경이나 자동 예약/수동 버튼 실행 여부는 추정하지 않습니다.</p>
  </section>;
}
