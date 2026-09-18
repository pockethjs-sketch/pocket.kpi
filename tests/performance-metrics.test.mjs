import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractRoasByType, dailyLeadCounts } from '../src/data/performanceMetrics.js';

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
  assert.match(source, /const dailyCounts = dailyLeadCounts\(/);
  assert.match(source, /label: "프리미팅", suffix: "건"/);
});
