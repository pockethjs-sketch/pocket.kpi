import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { contractRoasByType } from '../src/data/performanceMetrics.js';
import { paymentRows } from '../src/data/paymentSchedule.js';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function IntegratedPerformanceView()');
const setup = source.slice(source.indexOf('  const matchesCustomerType =', start), source.indexOf('  const targetFactor =', start));
const paymentHelpers = source.slice(source.indexOf('const isPayDone ='), source.indexOf('const isBizActive ='));
const calculate = new Function('db', 'r', 'period', 'customerType', 'marketingSpendForPeriod', 'inR', 'isPremeetingCompanyInRange', 'contractRoasByType', 'payRows', `${paymentHelpers}\n${setup}\nreturn {contractAmountTotal, contractRoas, contractPaidTotal, receivedRoas};`);
const inRange = (date, range) => !!date && (!range || date >= range[0] && date <= range[1]);
const lead = (id, extra = {}) => ({ id, status: '계약 완료', contractAt: '2026-09-10', ctype: '신규', contractAmount: 1000, ...extra });
const rows = [
  lead('partial', { paid: 9999, payments: [{ amount: 500, paidConfirmed: true }, { amount: 500, dueAt: '2026-09-15' }] }),
  lead('crm', { payments: [{ amount: 1000, crmManaged: true, depositAmount: 200, paidAt: '2026-09-12' }] }),
  lead('legacy', { ctype: '기존', paid: 300 }),
  lead('full', { ctype: '기존', payments: [{ amount: 1000, paidAt: '2026-10-01' }] }),
  lead('other-month', { contractAt: '2026-08-10', payments: [{ amount: 1000, paidAt: '2026-09-10' }] }),
  lead('uncontracted', { status: '프리미팅 완료', paid: 9999 }),
];
const run = (type = '전체', spend = 1000, range = ['2026-09-01', '2026-09-30'], leads = rows) => calculate({ leads }, range, {}, type, () => spend, inRange, () => false, contractRoasByType, paymentRows);

test('main receipt ROAS uses confirmed money of the same contract cohort, without double counting legacy paid', () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(run(), { contractAmountTotal: 4000, contractRoas: 400, contractPaidTotal: 2000, receivedRoas: 200 });
  assert.equal(JSON.stringify(rows), before);
});

test('both ROAS values apply new/existing and selected contract date filters with identical ad denominator', () => {
  assert.deepEqual(run('신규'), { contractAmountTotal: 2000, contractRoas: 200, contractPaidTotal: 700, receivedRoas: 70 });
  assert.deepEqual(run('기존'), { contractAmountTotal: 2000, contractRoas: 200, contractPaidTotal: 1300, receivedRoas: 130 });
  assert.equal(run('전체', 1000, ['2026-08-01', '2026-08-31']).contractPaidTotal, 1000);
  assert.equal(run('전체', 1000, null).contractPaidTotal, 3000);
});

test('unpaid, CRM zero-deposit and empty payment schedules never turn planned amounts into receipts', () => {
  const result = run('전체', 1000, null, [
    lead('unpaid', { payments: [{ amount: 1000 }] }),
    lead('crm-unpaid', { payments: [{ crmManaged: true, amount: 1000, depositAmount: 0, paidConfirmed: true }] }),
    lead('empty', { payments: [] }),
    lead('legacy-string', { payments: [], paid: '100' }),
  ]);
  assert.equal(result.contractPaidTotal, 100);
  assert.equal(result.receivedRoas, 10);
  assert.equal(run('전체', 1000, null, []).receivedRoas, 0);
  for (const spend of [0, null]) {
    assert.equal(run('전체', spend).contractRoas, null);
    assert.equal(run('전체', spend).receivedRoas, null);
  }
});

test('rendered ROAS summary and bottom notes distinguish both ratios, amounts, cohort basis and unavailable spend', async () => {
  const a = source.indexOf('{s.id === "contract" && <div', start);
  const footer = source.slice(a, source.indexOf('\n                <button', a));
  const notesStart = source.indexOf('<section className="kpi-method-notes"', start);
  const basisNote = source.slice(notesStart).split(/\r?\n/).find(line => line.includes('선택 기간 계약 기준 · 누적 확인 입금'));
  assert.ok(notesStart > a && basisNote, 'ROAS explanation remains in the requested bottom notes section');
  const { code } = await transformWithOxc(`function Footer(){ return <section>${footer}<aside>${basisNote}</aside></section> }`, 'Footer.jsx', { jsx: { runtime: 'classic' } });
  const render = (spend) => {
    const metrics = run('전체', spend);
    const scope = { React, ...metrics, roasSpend: spend, s: { id: 'contract' }, amountBefore: null, previousSpend: null, DailyDelta: () => null, fmtK: n => n.toLocaleString('ko-KR'), divide: (a,b) => b > 0 ? a / b * 100 : null };
    const Footer = new Function(...Object.keys(scope), code + ';return Footer;')(...Object.values(scope));
    return renderToStaticMarkup(React.createElement(Footer));
  };
  const html = render(1000);
  for (const text of ['계약금액 기준 ROAS', '실입금 기준 ROAS', '400%', '200%', '누적 확인 입금', '2,000', '선택 기간 계약 기준', '부분 입금은 받은 금액만']) assert.ok(html.includes(text), text);
  assert.ok(render(null).includes('산출 불가'));
  assert.ok(!render(0).includes('Infinity'));
});
