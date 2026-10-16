import React from 'react';
export default function InquiryBreakdown({ value, compact = false, dark = false }) {
  const count = n => n == null ? '미확인' : n.toLocaleString() + '건';
  return <div className={compact ? 'text-[10px] font-semibold ' + (dark ? 'text-slate-300' : 'text-slate-500') : 'rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-slate-600'} data-testid="inquiry-breakdown">
    <span>홈페이지 <b className={dark ? 'text-sky-300' : 'text-sky-700'}>{count(value.website)}</b></span><span className="mx-2">+</span><span>META DB <b className={dark ? 'text-indigo-300' : 'text-indigo-700'}>{count(value.meta)}</b></span>
    {!compact && <span className="ml-3 font-bold">합계 {count(value.total)}</span>}
    {value.error && <p className="mt-1 text-amber-700">{value.error} · CRM 고객 수로 대체하지 않습니다.</p>}
  </div>;
}
