import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { contractAmount, contractBasisEvents, summarizeContractBasis } from '../src/data/contractBasis.js';

async function compile(file, names, dependencies) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export default ', '').replaceAll('export function ', 'function ');
  const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic' } });
  return new Function(...Object.keys(dependencies), code + '\nreturn {' + names.join(',') + '};')(...Object.values(dependencies));
}
const { ContractOwnerSheet, ContractCustomerTypeLabel } = await compile('ContractOwnerSheet.jsx', ['ContractOwnerSheet', 'ContractCustomerTypeLabel'], { React, Fragment: React.Fragment });
let states = [], cursor = 0;
const { ContractBasisView } = await compile('ContractBasisView.jsx', ['ContractBasisView'], {
  React, ContractOwnerSheet, ContractCustomerTypeLabel, contractAmount, contractBasisEvents, summarizeContractBasis,
  useState: initial => { const index = cursor++; if (states[index] === undefined) states[index] = initial; return [states[index], value => { states[index] = value; }]; },
  useEffect() {}, useMemo: fn => fn(),
});
const leads = [
  { id: 'a', company: '8월 미팅 기업', status: '계약 완료', ctype: '신규', salesOwner: '담당 A', premeetingDoneAt: '2026-08-14', contractAt: '2026-09-07', contractAmount: 25000000, payments: [{ amount: 10000000, paidAt: '2026-09-07' }, { amount: 15000000, paidAt: '2026-10-07' }] },
  { id: 'b', company: '입금일 미상 기업', status: '계약 완료', ctype: '기존', payments: [{ amount: 5500000, paidConfirmed: true }], contractAmount: 5500000 },
];
const props = { leads, basis: 'payment', range: ['2026-09-01', '2026-09-30'], periodLabel: '9월', channelOf: value => value || '기타', openLead() {} };
const render = (overrides = {}, state = []) => { states = state; cursor = 0; return renderToStaticMarkup(ContractBasisView({ ...props, ...overrides })); };

test('receipt owner sheet labels and totals show actual selected receipts, not full contract values', () => {
  const html = render();
  assert.match(html, /기간 입금액/);
  assert.match(html, /₩10,000,000/);
  assert.doesNotMatch(html, /₩25,000,000|₩15,000,000/);
  assert.match(html, /입금일 미상 1건/);
  assert.match(html, /2026-09-07/);
});

test('meeting owner sheet shifts display to August without rewriting the record', () => {
  const html = render({ basis: 'meeting', range: ['2026-08-01', '2026-08-31'], periodLabel: '8월' });
  assert.match(html, /₩25,000,000/);
  assert.match(html, /2026-08-14/);
  assert.match(html, /미팅일 미상 1건/);
  assert.equal(leads[0].contractAt, '2026-09-07');
});

test('receipt monthly comparison splits installments across months and new/existing filters remain active', () => {
  const html = render({}, ['전체', 'monthly', '', '전체', '']);
  assert.match(html, /2026-09/);
  assert.match(html, /2026-10/);
  assert.match(html, /₩10,000,000/);
  assert.match(html, /₩15,000,000/);
  const existing = render({}, ['기존', 'owner', '', '전체', '']);
  assert.doesNotMatch(existing, /8월 미팅 기업/);
  assert.match(existing, /입금일 미상 기업/);
});

test('list view retains receipt dates and reference contract amount without mixing their totals', () => {
  const html = render({}, ['전체', 'list', '', '전체', '']);
  assert.match(html, /참고 계약 총액/);
  assert.match(html, /₩25,000,000/);
  assert.match(html, /2026-09-07/);
  assert.doesNotMatch(html, /2026-10-07/);
});
