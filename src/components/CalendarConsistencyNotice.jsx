import React from 'react';
import { assessCalendarDisplay } from '../data/calendarConsistency.js';

export function CalendarConsistencyNotice({ report, count, range, today, customerType, days, month }) {
  const check = assessCalendarDisplay(report, count, { range, today, customerType, days, month });
  if (check.state === 'ok' || check.state === 'filtered') return null;
  const mismatch = check.state === 'mismatch';
  return <div role={mismatch ? 'alert' : 'status'} aria-label="프리미팅 집계 대조 상태"
    className={'rounded-md border px-3 py-2 text-xs ' + (mismatch ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
    <p className="font-bold">{mismatch ? '프리미팅 집계 불일치' : '프리미팅 원본 대조 미확인'} · {check.reason}</p>
    {check.sourceTotal != null && <p className="mt-1">원본 {check.sourceTotal}건 / 화면 {check.screenTotal ?? '미확인'}건</p>}
    {!!check.differences.length && <p className="mt-1">{check.differences.slice(0, 8).map(row => `${row.date}: 원본 ${row.source} / 화면 ${row.screen}`).join(' · ')}{check.differences.length > 8 ? ` · 외 ${check.differences.length - 8}일` : ''}</p>}
    <p className="mt-1 opacity-80">숫자를 자동 수정하지 않습니다. 정기 점검에서 원본/API/화면 집계 코드의 차이를 확인합니다.</p>
  </div>;
}
