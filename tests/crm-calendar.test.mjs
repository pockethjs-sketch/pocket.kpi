import test from 'node:test';
import assert from 'node:assert/strict';
import { crmCalendar } from '../supabase/functions/_shared/crm-calendar.mjs';
import { calendarActivityLeads } from '../src/data/calendarActivity.js';
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
test('latest CRM version wins, including type changes; arrays do not change source leads', () => {
  const rows = [{ id: 1, external_id: '9', last_seen_at: '2026-10-08', payload: { mr_type: 1, start_dt: '2026-10-08' } },
    { id: 2, external_id: '9', last_seen_at: '2026-10-09', payload: { mr_type: 2, start_dt: '2026-10-08' } }];
  assert.deepEqual(crmCalendar(rows), []);
  const lead = { id: 'crm-1', crmMeetings: [] };
  calendarActivityLeads([{ clientNo: 1, msNo: 5, type: 1 }], [lead]);
  assert.deepEqual(lead.crmMeetings, []);
});
