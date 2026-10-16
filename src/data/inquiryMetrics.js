// One counted fact per source/date. Customer inventory is never an inquiry fallback.
export function buildInquiryReport(rows = [], states = []) {
  const days = new Map();
  const seen = new Set();
  for (const row of rows) {
    const day = days.get(row.inquiry_date) || { date: row.inquiry_date, website: null, meta: null, websiteChannels: null };
    const key = row.source === 'WEBSITE' ? 'website' : row.source === 'META' ? 'meta' : null;
    if (!key) continue;
    const identity = row.inquiry_date + ':' + key;
    day[key] = seen.has(identity) ? null : Number(row.inquiry_count);
    seen.add(identity);
    if (key === 'website') day.websiteChannels = row.channels;
    days.set(row.inquiry_date, day);
  }
  const sources = Object.fromEntries(states.map(row => [row.source, { ...row }]));
  for (const state of states) {
    if (state.status !== 'SUCCESS') continue;
    const subset = rows.filter(row => row.source === state.source && row.inquiry_date >= state.range_start && row.inquiry_date <= state.range_end);
    const sum = subset.reduce((total, row) => total + Number(row.inquiry_count), 0);
    const expected = Array.isArray(state.expected_daily) ? state.expected_daily : [];
    const dates = new Map(subset.map(row => [row.inquiry_date, row]));
    const differences = expected.filter(day => !dates.has(day.date) || Number(dates.get(day.date).inquiry_count) !== day.count
      || ['META','NAVER','GOOGLE','OTHER'].some(key => dates.get(day.date).channels?.[key] !== day.channels?.[key]))
      .map(day => ({ date: day.date, source: day.count, stored: dates.has(day.date) ? dates.get(day.date).inquiry_count : null }));
    if (!subset.length || sum !== state.source_total || subset.some(row => row.source_hash !== state.source_hash) || !expected.length || expected.length !== subset.length || differences.length) {
      sources[state.source] = { ...state, status: 'INCONSISTENT', error_code: 'inquiry_aggregation_mismatch', differences };
      for (const row of subset) days.get(row.inquiry_date)[state.source === 'WEBSITE' ? 'website' : 'meta'] = null;
    }
  }
  return { schemaVersion: 1, daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), sources };
}
const validCount = n => Number.isSafeInteger(n) && n >= 0;
export function inquiryPeriod(report, range, today, customerType = '전체') {
  const rows = Array.isArray(report?.daily) ? report.daily : [];
  const start = range?.[0] || rows[0]?.date;
  const end = range?.[1] && range[1] < today ? range[1] : today;
  const byDate = new Map(rows.map(row => [row.date, row]));
  const daily = [];
  if (start && end && start <= end) for (let date = new Date(start + 'T00:00:00Z'); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10), row = byDate.get(key);
    const website = validCount(row?.website) ? row.website : null;
    const meta = validCount(row?.meta) ? row.meta : null;
    const channels = row?.websiteChannels || {};
    const channelsValid = ['META', 'NAVER', 'GOOGLE', 'OTHER'].every(k => validCount(channels[k])) && Object.values(channels).reduce((sum, n) => sum + Number(n), 0) === website;
    daily.push({ date: key, website, meta, count: website != null && meta != null ? website + meta : null,
      channels: channelsValid && meta != null ? { ...channels, META: channels.META + meta } : null, entries: [], completed: 0, unconfirmed: 0 });
    if (daily.length > 3660) break;
  }
  const complete = report?.schemaVersion === 1 && daily.length > 0;
  const sum = key => complete && daily.every(day => day[key] != null) ? daily.reduce((total, day) => total + day[key], 0) : null;
  const website = sum('website'), meta = sum('meta');
  const scoped = customerType !== '전체';
  const total = !scoped && website != null && meta != null ? website + meta : null;
  const channels = complete && daily.every(day => day.channels) ? Object.fromEntries(['META','NAVER','GOOGLE','OTHER'].map(key => [key, daily.reduce((sum, day) => sum + day.channels[key], 0)])) : null;
  const states = report?.sources || {};
  const sourceProblems = ['WEBSITE','META'].some(source => states[source]?.status !== 'SUCCESS');
  const stale = ['WEBSITE','META'].some(source => !states[source]?.last_success_at || Date.now() - new Date(states[source].last_success_at) > 30 * 3600000);
  return { start, end, website, meta, total, daily: daily.map(day => scoped ? { ...day, count: null } : day), channels,
    verified: total != null && !sourceProblems && !stale && !report?.readError, scoped, sources: states, error: scoped ? '문의 원본은 신규·기존 구분 미제공' : total == null ? '문의 원본 조회 미확인' : sourceProblems ? '문의 수집 상태 미확인 또는 실패 · 마지막 저장값' : stale ? '문의 갱신 지연 · 마지막 저장값' : '' };
}
export const inquiryReportOf = db => db?.adSpendMeta?.inquiries || null;
export function inquiryDailyActivity(report, month, today, range = null, customerType = '전체') {
  const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).toISOString().slice(0,10);
  const result = inquiryPeriod(report, [month + '-01', last], today, customerType);
  return result.daily.filter(day => !range || day.date >= range[0] && day.date <= range[1]);
}
