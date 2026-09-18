import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractRoasByType, dailyLeadCounts, dailyStageActivity } from '../src/data/performanceMetrics.js';

test('contract ROAS uses contract month and amount for new and existing companies', () => {
  const leads = [
    { status: '계약 완료', contractAt: '2026-09-03', ctype: '신규', contractAmount: 5500000, createdAt: '2026-08-01' },
    { status: '계약 완료', contractAt: '2026-09-04', ctype: '기존', payments: [{ amount: 2200000 }], createdAt: '2026-07-01' },
    { status: '계약 완료', contractAt: '2026-08-31', ctype: '신규', contractAmount: 9999999 },
    { status: '프리미팅 완료', contractAt: '2026-09-05', contractAmount: 9999999 },
  ];
  assert.deepEqual(contractRoasByType(leads, ['2026-09-01', '2026-09-30'], 1000000), {
    amount: 7700000, newAmount: 5500000, existingAmount: 2200000,
    totalRoas: 770, newRoas: 550, existingRoas: 220,
  });
  assert.equal(contractRoasByType(leads, ['2026-09-01', '2026-09-30'], null).newRoas, null);
});

test('daily CRM inflow includes zero days and stops at today for current month', () => {
  const leads = [
    { createdAt: '2026-09-01' }, { createdAt: '2026-09-01T12:00:00' },
    { createdAt: '2026-09-03' }, { createdAt: '2026-08-31' },
  ];
  const days = dailyLeadCounts(leads, '2026-09', '2026-09-18');
  assert.equal(days.length, 18);
  assert.deepEqual(days.slice(0, 3), [
    { date: '2026-09-01', count: 2 }, { date: '2026-09-02', count: 0 }, { date: '2026-09-03', count: 1 },
  ]);
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 3);
  assert.equal(dailyLeadCounts(leads, '2026-08', '2026-09-18').length, 31);
});

test('marketing trend and integrated performance share contract ROAS and daily inflow code', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /const contractPerformance = contractRoasByType\(db\.leads, r, roasSpend\)/);
  assert.match(source, /const contractPerformance = contractRoasByType\(db\.leads, r, spend\)/);
  assert.match(source, /const contracts = contractRoasByType\(db\.leads, monthRange, monthSpend\)/);
  assert.match(source, /const dailyCounts = dailyStageActivity\(/);
  assert.match(source, /label: "프리미팅", suffix: "건"/);
});

test('daily meetings use KST meeting dates and attendance on each event, not company status', () => {
  const lead = { id: 'repeat', status: '계약 완료', premeetingDoneAt: '2026-09-01', crmMeetings: [
    { type: 1, startAt: '2026-09-02T23:30:00Z', checked: 1 },
    { type: 1, startAt: '2026-09-03T13:00:00+09:00', checked: 0 },
    { type: 1, startAt: '2026-09-04T14:00:00', checked: 0 },
    { type: 2, startAt: '2026-09-05T14:00:00+09:00', checked: 1 },
    { type: 1, startAt: '2026-09-20T14:00:00+09:00', checked: 1 },
  ] };
  const days = dailyStageActivity([lead], 'pre', '2026-09', '2026-09-18');
  assert.equal(days[0].count, 0, 'legacy dates do not duplicate calendar events');
  assert.equal(days[2].count, 1, 'one company on the same date counts once');
  assert.equal(days[2].completed, 1);
  assert.equal(days[3].unconfirmed, 1, 'contract status does not confirm later meetings');
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 2);
});

test('manual attendance and historical dropped visits remain visible, creation dates are not meetings', () => {
  const days = dailyStageActivity([
    { id: 'drop', status: '드랍', premeetingDoneAt: '2026-09-05' },
    { id: 'scheduled', status: '프리미팅 확정', premeetingAt: '2026-09-05' },
    { id: 'no-date', status: '계약 완료', createdAt: '2026-09-05', contractAt: '2026-09-05' },
  ], 'pre', '2026-09', '2026-09-18');
  assert.equal(days[4].completed, 1);
  assert.equal(days[4].unconfirmed, 1);
  assert.equal(days[4].entries.length, 2);
});

test('daily contracts use completed contract date and retain rows for amount drilldown', () => {
  const lead = { id: 'contract', status: '계약 완료', contractAt: '2026-09-07', createdAt: '2026-08-03', contractAmount: 5500000 };
  const days = dailyStageActivity([lead, { status: '프리미팅 완료', contractAt: '2026-09-07' }], 'contract', '2026-09', '2026-09-18', ['2026-09-05', '2026-09-08']);
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 1);
  assert.equal(days[6].entries[0].lead, lead);
});
