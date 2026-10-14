import { crmCalendar } from './crm-calendar.mjs';
import { calendarActivityLeads, calendarPeriodEntries } from '../../../src/data/calendarActivity.js';
import { dailyStageActivity } from '../../../src/data/performanceMetrics.js';

function kstDate(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(/[T ]/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw.replace(' ', 'T') + '+09:00' : raw);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
const counts = entries => {
  const daily = {};
  for (const date of entries) daily[date] = (daily[date] || 0) + 1;
  return daily;
};

// Independent raw-row oracle versus the actual API and frontend computation.
// Result is metadata-only. Never persist IDs, names, notes or source payloads here.
export function verifyCalendarConsistency(rawRows, { start, end, today,
  calendar = crmCalendar(rawRows), screenEntries, screenDays } = {}) {
  const last = end < today ? end : today;
  const inPeriod = date => date && date >= start && date <= last;
  const latest = new Map();
  for (const row of rawRows || []) {
    const id = String(row.external_id || '');
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || String(row.last_seen_at) > String(prev.last_seen_at)
      || (row.last_seen_at === prev.last_seen_at && Number(row.id) > Number(prev.id))) latest.set(id, row);
  }
  const sourceIds = new Map();
  let sourceLatestAt = '';
  for (const [id, row] of latest) {
    const p = row.payload || {}, date = kstDate(p.start_dt);
    if (Number(p.mr_type) !== 1 || !inPeriod(date)) continue;
    sourceIds.set(id, date);
    if (String(row.last_seen_at || '') > sourceLatestAt) sourceLatestAt = row.last_seen_at;
  }
  const apiIds = new Map();
  for (const meeting of calendar || []) {
    const date = kstDate(meeting.startAt);
    if (Number(meeting.type) === 1 && inPeriod(date)) apiIds.set(String(meeting.msNo), date);
  }
  const entries = screenEntries ?? calendarPeriodEntries(calendar, [], [start, last], today);
  const sourceDaily = counts(sourceIds.values()), apiDaily = counts(apiIds.values());
  const months = [...new Set(Object.keys(sourceDaily).concat(Object.keys(apiDaily)).map(date => date.slice(0, 7)))];
  const days = screenDays ?? months.flatMap(month => dailyStageActivity(calendarActivityLeads(calendar, []), 'pre', month, today, [start, last]));
  const screenDaily = Object.fromEntries(days.filter(day => day.count).map(day => [day.date, day.count]));
  const dates = [...new Set([...Object.keys(sourceDaily), ...Object.keys(apiDaily), ...Object.keys(screenDaily)])].sort();
  const differences = dates.flatMap(date => {
    const source = sourceDaily[date] || 0, api = apiDaily[date] || 0, screen = screenDaily[date] || 0;
    return source === api && source === screen ? [] : [{ date, source, api, screen, missing: source - screen }];
  });
  const identityMismatch = [...new Set([...sourceIds.keys(), ...apiIds.keys()])]
    .filter(id => sourceIds.get(id) !== apiIds.get(id)).length;
  const sourceTotal = sourceIds.size, apiTotal = apiIds.size, screenTotal = entries?.length ?? null;
  const dailyTotal = days.reduce((sum, day) => sum + day.count, 0);
  return { schemaVersion: 1, level: 'raw-api-screen-model', start, end: last, asOf: today,
    verified: Array.isArray(calendar) && screenTotal === sourceTotal && apiTotal === sourceTotal
      && dailyTotal === sourceTotal && !differences.length && !identityMismatch,
    source: { total: sourceTotal, daily: sourceDaily, latestAt: sourceLatestAt },
    api: { total: apiTotal, daily: apiDaily }, screen: { total: screenTotal, dailyTotal, daily: screenDaily },
    identityMismatch, differences };
}
