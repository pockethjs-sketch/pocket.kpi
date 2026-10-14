// Compare the actual numbers handed to cards/charts, not just a success status.
// This is a display-only check; no API calls, source repairs, or storage writes.
export function assessCalendarDisplay(report, displayedCount, { range, today, customerType = '전체', days, month } = {}) {
  if (!report?.source || report.schemaVersion !== 1) return { state: 'pending', reason: '원본 대조 결과 미확인', differences: [] };
  if (!report.verified) return { state: 'mismatch', reason: '원본·API·화면 집계 코드 불일치', differences: report.differences || [] };
  const end = !range?.[1] || range[1] > today ? today : range[1];
  const start = range?.[0];
  if (!start || start < report.start || end > report.end || report.asOf !== today)
    return { state: 'pending', reason: '선택 기간 또는 오늘 기준 원본 대조 미확인', differences: [] };
  if (customerType !== '전체') return { state: 'filtered', reason: '전체 원본 대조 정상 · 고객 유형 필터는 별도', differences: [] };
  const expected = Object.entries(report.source.daily).filter(([date]) => date >= start && date <= end);
  const total = expected.reduce((sum, [, count]) => sum + count, 0);
  const differences = [];
  if (Array.isArray(days)) {
    const actual = new Map(days.map(day => [day.date, day.count]));
    const dates = new Set([...expected.map(([date]) => date), ...actual.keys()]);
    for (const date of [...dates].sort()) {
      if (date < start || date > end || (month && !date.startsWith(month + '-'))) continue;
      const source = report.source.daily[date] || 0, screen = actual.get(date) || 0;
      if (source !== screen) differences.push({ date, source, screen, missing: source - screen });
    }
  }
  return { state: displayedCount !== total || differences.length ? 'mismatch' : 'ok',
    reason: '원본·화면 합계/일별 대조', sourceTotal: total, screenTotal: displayedCount, differences };
}
