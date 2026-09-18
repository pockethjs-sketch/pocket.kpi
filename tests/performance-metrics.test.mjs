import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractRoasByType, dailyLeadCounts, dailyStageActivity, dailyComparisonWindow, relativeMetricChange, previousDatedSpend } from '../src/data/performanceMetrics.js';

test('daily comparison keeps month start and compares cumulative totals without future dates', () => {
  assert.deepEqual(dailyComparisonWindow(['2026-09-01', '2026-09-30'], '2026-09-18'), {
    current: ['2026-09-01', '2026-09-18'], previous: ['2026-09-01', '2026-09-17'], end: '2026-09-18', before: '2026-09-17',
  });
  assert.equal(dailyComparisonWindow(['2026-10-01', '2026-10-31'], '2026-09-18'), null);
  assert.equal(dailyComparisonWindow(['2026-08-01', '2026-08-31'], '2026-09-18').end, '2026-08-31');
  assert.deepEqual(dailyComparisonWindow(['2026-09-01', '2026-09-01'], '2026-09-18', true).previous, ['2026-08-31', '2026-08-31']);
  assert.deepEqual(dailyComparisonWindow(['2026-09-01', '2026-09-30'], '2026-09-01').previous, ['2026-09-01', '2026-08-31']);
});

test('relative change handles zero, missing, decline and unrounded ratio values honestly', () => {
  assert.equal(relativeMetricChange(106, 100).text, '▲ 6%');
  assert.equal(relativeMetricChange(94, 100).text, '▼ 6%');
  assert.equal(relativeMetricChange(0, 0).text, '— 0%');
  assert.equal(relativeMetricChange(3, 0).text, '신규 발생');
  assert.equal(relativeMetricChange(0, 3).text, '▼ 100%');
  assert.equal(relativeMetricChange(100, null).text, '비교 불가');
  assert.equal(relativeMetricChange(Infinity, 1).text, '비교 불가');
  assert.equal(relativeMetricChange(500, 400).text, '▲ 25%', 'ROAS change is relative, not 100 percentage points');
  assert.equal(relativeMetricChange(100.001, 100).text, '▲ <0.1%');
});

test('daily spend reconciles with displayed total and accepts once-daily D-1 collection', () => {
  const window = dailyComparisonWindow(['2026-09-01', '2026-09-30'], '2026-09-18');
  const data = Object.fromEntries(['META', 'NAVER', 'GOOGLE'].map(key => [key, [{ date: '2026-09-17', spend: 100 }]]));
  assert.equal(previousDatedSpend(data, window, 300), 300);
  data.META.push({ date: '2026-09-18', spend: 50 });
  assert.equal(previousDatedSpend(data, window, 350), 300);
  assert.equal(previousDatedSpend(data, window, 999), null, 'cannot fabricate daily values from a monthly aggregate');
  assert.equal(previousDatedSpend({}, window, 0), null);
  delete data.GOOGLE;
  assert.equal(previousDatedSpend(data, window, 250), null, 'missing provider is not zero spend');
});

test('stale daily spend cannot produce a reassuring zero-percent change', () => {
  const window = dailyComparisonWindow(['2026-09-01', '2026-09-30'], '2026-09-18');
  const data = Object.fromEntries(['META', 'NAVER', 'GOOGLE'].map(key => [key, [{ date: '2026-09-16', spend: 100 }]]));
  assert.equal(previousDatedSpend(data, window, 300), null);
});

test('integrated comparison uses the customer filter and refuses future-inclusive totals', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('  const comparisonWindow = dailyComparisonWindow'), source.indexOf('  const DailyDelta ='));
  const calculate = new Function('db', 'r', 'todayISO', 'period', 'matchesCustomerType', 'inR', 'isPremeetingCompanyInRange', 'contractRoasByType', 'dailyComparisonWindow', 'previousDatedSpend', 'roasSpend', 'contractAmountTotal', block + '\nreturn { comparisonCurrent, comparisonPrevious, countBefore, amountBefore, previousSpend, comparisonLabel, divide };');
  const range = ['2026-09-01', '2026-09-30'];
  const inR = (date, r) => !!date && date >= r[0] && date <= r[1];
  const leads = [
    { createdAt: '2026-09-17', ctype: '신규', status: '계약 완료', contractAt: '2026-09-17', contractAmount: 500, premeetingAt: '2026-09-17' },
    { createdAt: '2026-09-18', ctype: '신규', status: '계약 완료', contractAt: '2026-09-18', contractAmount: 100, premeetingAt: '2026-09-18' },
    { createdAt: '2026-09-18', ctype: '기존', status: '계약 완료', contractAt: '2026-09-18', contractAmount: 900 },
  ];
  const adDaily = Object.fromEntries(['META', 'NAVER', 'GOOGLE'].map(key => [key, [{ date: '2026-09-17', spend: 100 }]]));
  const result = calculate({ leads, adDaily }, range, () => '2026-09-18', { mode: 'month' }, l => l.ctype === '신규', inR, (l, r) => inR(l.premeetingAt, r), contractRoasByType, dailyComparisonWindow, previousDatedSpend, 300, 600);
  assert.deepEqual(result.comparisonCurrent, { marketing: 2, pre: 2, contract: 2, amount: 600 });
  assert.deepEqual(result.comparisonPrevious, { marketing: 1, pre: 1, contract: 1, amount: 500 });
  assert.equal(result.countBefore('pre', 2), 1);
  assert.equal(result.countBefore('pre', 3), null, 'monthly total includes a future appointment: do not compare it to yesterday');
  assert.equal(result.previousSpend, 300);
  assert.equal(relativeMetricChange(result.divide(600, 300, 100), result.divide(result.amountBefore, result.previousSpend, 100)).text, '▲ 20%');
});

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
