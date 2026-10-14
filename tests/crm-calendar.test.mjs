import test from 'node:test';
import assert from 'node:assert/strict';
import { crmCalendar } from '../supabase/functions/_shared/crm-calendar.mjs';
import { calendarActivityLeads, calendarPeriodEntries } from '../src/data/calendarActivity.js';
import { dailyStageActivity } from '../src/data/performanceMetrics.js';
test('raw calendar includes October 8 schedules even when none are projected into leads', () => {
  const raw = [1, 2, 3].map(id => ({ id, external_id: String(id), last_seen_at: '2026-10-10',
    payload: { mr_type: 1, start_dt: '2026-10-08T10:00:00+09:00', client_no: id, client_name: '합성 업체', private_note: 'must not escape' } }));
  const calendar = crmCalendar(raw);
  const views = calendarActivityLeads(calendar, [{ id: 'crm-1', company: '합성 업체1', ctype: '기존', payments: [] }]);
  const days = dailyStageActivity(views, 'pre', '2026-10', '2026-10-14');
  assert.equal(days[7].count, 3);
  assert.equal(views.filter(row => row.id).length, 1);
  assert.equal(views[1].ctype, '미분류');
  assert.equal(calendar[0].private_note, undefined);
});

test('29 schedules produce the same card, daily and period comparison rows, not 21 companies', () => {
  const calendar = Array.from({ length: 29 }, (_, i) => ({ msNo: i + 1, type: 1, clientNo: i % 21,
    startAt: `2026-10-${String(i % 14 + 1).padStart(2, '0')}T10:00:00+09:00`, checked: i % 2 }));
  calendar.push({ msNo: 100, type: 1, startAt: '2026-10-15T10:00:00+09:00' });
  const leads = Array.from({ length: 21 }, (_, i) => ({ id: 'crm-' + i, ctype: i % 2 ? '기존' : '신규' }));
  const range = ['2026-10-01', '2026-10-31'];
  const entries = calendarPeriodEntries(calendar, leads, range, '2026-10-14');
  const days = dailyStageActivity(calendarActivityLeads(calendar, leads), 'pre', '2026-10', '2026-10-14', range);
  assert.equal(entries.length, 29);
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), entries.length);
  assert.equal(entries.length * (2900000 / entries.length), 2900000);
  assert.equal(calendarPeriodEntries(calendar, leads, range, '2026-10-14', '신규').length
    + calendarPeriodEntries(calendar, leads, range, '2026-10-14', '기존').length, 29);
  assert.equal(calendarPeriodEntries(undefined, leads, range, '2026-10-14'), null);
});
test('latest CRM version wins, including type changes; arrays do not change source leads', () => {
  const rows = [{ id: 1, external_id: '9', last_seen_at: '2026-10-08', payload: { mr_type: 1, start_dt: '2026-10-08' } },
    { id: 2, external_id: '9', last_seen_at: '2026-10-09', payload: { mr_type: 2, start_dt: '2026-10-08' } }];
  assert.deepEqual(crmCalendar(rows), []);
  const lead = { id: 'crm-1', crmMeetings: [] };
  calendarActivityLeads([{ clientNo: 1, msNo: 5, type: 1 }], [lead]);
  assert.deepEqual(lead.crmMeetings, []);
});

test('period totals retain unlinked and weekend schedules with KST dates, deduplication and day filters', () => {
  const calendar = [
    { msNo: 1, type: 1, startAt: '2026-09-30T16:00:00Z' },
    { msNo: 1, type: 1, startAt: '2026-09-30T16:00:00Z' },
    { msNo: 2, type: 1, startAt: '2026-10-03T10:00:00+09:00' },
    { msNo: 3, type: 1, startAt: '2026-09-29T10:00:00+09:00' },
    { msNo: 4, type: 2, startAt: '2026-10-01T10:00:00+09:00' },
    { msNo: 5, type: 1, startAt: '2026-10-15T10:00:00+09:00' },
  ];
  const entries = calendarPeriodEntries(calendar, [], ['2026-09-01','2026-10-31'], '2026-10-14');
  assert.deepEqual(entries.map(e => e.date), ['2026-09-29','2026-10-01','2026-10-03']);
  assert.ok(entries.every(e => e.lead.id === ''));
  assert.equal(calendarPeriodEntries(calendar, [], ['2026-10-01','2026-10-01'], '2026-10-14').length, 1);
});
