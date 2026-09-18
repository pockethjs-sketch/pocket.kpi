import test from 'node:test';
import assert from 'node:assert/strict';
import { contractBasisEvents, contractMeetingDate, summarizeContractBasis } from '../src/data/contractBasis.js';

const lead = { id: 'example', company: '미팅·계약월 차이 예시', ctype: '신규', status: '계약 완료', contractAt: '2026-09-07', premeetingDoneAt: '2026-08-14', contractAmount: 25000000,
  payments: [{ amount: 10000000, paidAt: '2026-09-07', label: '선금' }, { amount: 15000000, paidAt: '2026-10-10', label: '잔금' }] };

test('meeting cohort attributes the full contract once to August without changing September contract date', () => {
  const before = JSON.stringify(lead);
  const august = summarizeContractBasis([lead], 'meeting', ['2026-08-01', '2026-08-31']);
  assert.equal(august.total, 25000000);
  assert.equal(august.rows.length, 1);
  assert.equal(summarizeContractBasis([lead], 'meeting', ['2026-09-01', '2026-09-30']).total, 0);
  assert.equal(JSON.stringify(lead), before);
});

test('payments are attributed by actual receipt date, not the contract total or meeting month', () => {
  const september = summarizeContractBasis([lead], 'payment', ['2026-09-01', '2026-09-30']);
  assert.equal(september.total, 10000000);
  assert.equal(september.rows[0].basisEvents.length, 1);
  assert.equal(summarizeContractBasis([lead], 'payment', ['2026-10-01', '2026-10-31']).total, 15000000);
  assert.equal(summarizeContractBasis([lead], 'payment', ['2026-08-01', '2026-08-31']).total, 0);
  assert.equal(summarizeContractBasis([lead], 'payment', null, '기존').total, 0);
});

test('confirmed undated payments and legacy paid balances are visible as undated, never assigned to a due date', () => {
  const rows = [
    { id: 'confirmed', contractAt: '2026-09-07', payments: [{ amount: 5500000, paidConfirmed: true, dueAt: '2026-09-07' }] },
    { id: 'legacy', paid: 1000000 },
    { id: 'unpaid', payments: [{ amount: 9900000, dueAt: '2026-09-07' }] },
    { id: 'invalid', payments: [{ amount: 500, paidAt: '2026-02-31' }] },
  ];
  const result = summarizeContractBasis(rows, 'payment', ['2026-09-01', '2026-09-30']);
  assert.equal(result.total, 0);
  assert.equal(result.undated.length, 3);
  assert.equal(result.undated.reduce((sum, row) => sum + row.amount, 0), 6500500);
});

test('CRM partial receipts use deposit amount/date and multiple installments remain one company', () => {
  const result = summarizeContractBasis([{ id: 'crm', status: '계약 완료', payments: [
    { crmManaged: true, amount: 10000000, depositAmount: 2000000, depositAt: '2026-09-05' },
    { amount: 500000, paidAt: '2026-09-08' },
    { crmManaged: true, amount: 10000000, paidAt: '2026-09-09', depositAmount: 0 },
  ] }], 'payment', ['2026-09-01', '2026-09-30']);
  assert.equal(result.total, 2500000);
  assert.equal(result.events.length, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].basisDate, '2026-09-08');
});

test('repeat calendar visits are assigned once using earliest KST meeting, missing dates are not invented', () => {
  const repeat = { ...lead, crmMeetings: [{ type: 1, startAt: '2026-08-31T23:00:00Z' }, { type: 1, startAt: '2026-10-01T10:00:00+09:00' }, { type: 2, startAt: '2026-07-01' }] };
  assert.equal(contractMeetingDate(repeat), '2026-09-01');
  assert.equal(contractBasisEvents([repeat], 'meeting').events.length, 1);
  const missing = { id: 'missing', status: '계약 완료', contractAt: '2026-09-07', createdAt: '2026-09-01', contractAmount: 100 };
  assert.equal(contractBasisEvents([missing], 'meeting').events.length, 0);
  assert.equal(contractBasisEvents([missing], 'meeting').undated.length, 1);
});
