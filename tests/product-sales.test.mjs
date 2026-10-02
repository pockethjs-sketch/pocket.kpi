import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import vm from 'node:vm';
import { salesBuildups, summarizeProductSales } from '../src/data/productSales.js';

const range = ['2026-09-01', '2026-09-30'];
const lead = (id, extra = {}) => ({ id, company: '테스트 기업 ' + id, status: '계약 완료', contractAt: '2026-09-12', contractAmount: 1100000, buildup: '투자유치', ctype: '신규', ...extra });
const products = [{ name: '투자유치', items: [{ name: 'IR 제작' }] }, { name: '지원사업 관리', items: [{ name: '사업계획서' }] }, { name: '맞춤 상품', items: [] }];

test('actual catalog preserves price/target fields and disables viewer editing without writes', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const view = source.slice(source.indexOf('function ProductsView() {'), source.indexOf('function SettingsView() {'));
  const compiled = await transformWithOxc(view, 'ProductsView.jsx', { jsx: { runtime: 'classic' } });
  const fixture = { products: [{ id: 'p1', name: '테스트 상품', rr: '테스트 담당', duration: '4주', items: [{ id: 'i1', name: '테스트 항목', price: 1230000, mTarget: 5 }] }], leads: [] };
  let writes = 0;
  const box = ({ children }) => React.createElement('div', null, children);
  for (const role of ['VIEWER', 'OWNER']) {
    const context = vm.createContext({ React, useExcelExport() {}, useState: () => ['catalog', () => {}], useApp: () => ({ db: fixture, up: () => { writes++; }, period: {}, openLead: () => {} }), window: { kpiEmployeeAccess: { role } }, SecTitle: box, Package: box, Plus: box, Trash2: box, Card: box, Fld: box, Inp: props => React.createElement('input', { ...props, onChange: props.onChange }), Btn: box, DangerBtn: box });
    vm.runInContext(compiled.code + '\nglobalThis.Subject = ProductsView;', context);
    const html = renderToStaticMarkup(React.createElement(context.Subject));
    assert.ok(html.includes('1,230,000'));
    assert.ok(html.includes('value="5"'));
    assert.equal(html.includes('<fieldset disabled=""'), role === 'VIEWER');
    assert.equal(html.includes('빌드업 추가'), role === 'OWNER');
    assert.equal(html.includes('항목 추가'), role === 'OWNER');
  }
  assert.equal(writes, 0);
});

test('sales use contract date and completed positive contracts, not meeting or payment dates', () => {
  const result = summarizeProductSales([lead('one'), lead('old', { contractAt: '2026-08-31', premeetingDoneAt: '2026-09-10' }), lead('pending', { status: '프리미팅 완료' }), lead('zero', { contractAmount: 0 }), lead('missing', { contractAt: '', createdAt: '2026-09-10' })], products, range);
  assert.equal(result.total, 1);
  assert.equal(result.amount, 1100000);
  assert.equal(result.undated.length, 1);
  assert.equal(result.missingAmount.length, 1);
});

test('counts new and existing contracts and includes zero-sale products', () => {
  const leads = [lead('new'), lead('existing', { ctype: '기존' }), lead('empty', { ctype: '' }), lead('other', { ctype: '확인 필요' })];
  const result = summarizeProductSales(leads, products, range);
  const group = result.groups.find(group => group.name === '투자유치');
  assert.deepEqual([group.count, group.newCount, group.existingCount, group.otherCount], [4, 2, 1, 1]);
  assert.equal(result.groups.find(group => group.name === '맞춤 상품').count, 0);
  assert.equal(summarizeProductSales(leads, products, range, '기존').total, 1);
  assert.equal(summarizeProductSales(leads, products, range, '신규').total, 2);
});

test('multiple buildups count once each, repeated payments and line items never multiply contracts', () => {
  const sample = lead('multi', { buildups: ['투자유치', '지원사업 관리'], lineItems: [{ buildup: '투자유치', quantity: 8 }, { buildup: '투자유치' }], payments: [{ amount: 550000 }, { amount: 550000 }] });
  const before = JSON.stringify(sample);
  const result = summarizeProductSales([sample, sample], products, range);
  assert.equal(result.total, 1);
  assert.equal(result.multiple, 1);
  assert.equal(result.amount, 1100000);
  assert.equal(result.groups.reduce((sum, group) => sum + group.count, 0), 2);
  assert.equal(JSON.stringify(sample), before);
});

test('exact item mapping, legacy labels, custom names and ambiguous mappings are explicit', () => {
  assert.deepEqual(salesBuildups({ buildup: '', lineItems: [{ name: 'IR 제작' }] }, products).groups, ['투자유치']);
  assert.deepEqual(salesBuildups({ buildup: '정부지원A', buildups: ['투자유치B', '홈페이지(V1)'] }, products).groups, ['지원사업 관리', '투자유치', '브랜딩 관리']);
  assert.deepEqual(salesBuildups({ buildup: '맞춤 상품' }, products).groups, ['맞춤 상품']);
  const ambiguous = [...products, { name: 'AX 개발', items: [{ name: 'IR 제작' }] }];
  assert.deepEqual(salesBuildups({ buildup: 'IR 제작' }, ambiguous).groups, ['미분류']);
  const unknown = salesBuildups({ buildup: '알 수 없는 상품', memo: '투자유치 계약' }, products);
  assert.deepEqual(unknown.groups, ['미분류']);
  assert.deepEqual(unknown.unmapped, ['알 수 없는 상품']);
});

test('archived and missing IDs excluded, amount fallback uses schedule, missing groups retained', () => {
  const result = summarizeProductSales([lead('archived', { archived_at: '2026-09-20' }), lead('removed', { deletedAt: '2026-09-20' }), lead(''), lead('schedule', { contractAmount: 0, payments: [{ amount: 400 }, { amount: 600 }], buildup: '' })], products, range);
  assert.equal(result.total, 1);
  assert.equal(result.amount, 1000);
  assert.equal(result.unclassified, 1);
});

test('Korean timezone boundaries, invalid dates, all-time and unknown amounts stay explicit', () => {
  const result = summarizeProductSales([lead('kst', { contractAt: '2026-08-31T16:00:00Z' }), lead('oct', { contractAt: '2026-09-30T16:00:00Z' }), lead('invalid', { contractAt: '2026-02-31' }), lead('negative', { contractAmount: -100 }), lead('infinity', { contractAmount: Infinity })], products, range);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].date, '2026-09-01');
  assert.equal(result.undated.length, 1);
  assert.equal(result.missingAmount.length, 2);
  assert.equal(summarizeProductSales([lead('old', { contractAt: '2025-01-01' }), lead('nodate', { contractAt: '' })], products, null).total, 1);
});

test('production component renders count table, data-quality notice and no conversion or inflated category revenue', async () => {
  const source = readFileSync(new URL('../src/ProductSalesOverview.jsx', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'ProductSalesOverview.jsx', { jsx: { runtime: 'classic' } });
  const code = compiled.code.replace(/from ["']react["']/g, `from '${import.meta.resolve('react')}'`).replace('./data/productSales.js', new URL('../src/data/productSales.js', import.meta.url).href).replace(/import \{ useExcelExport \} from ["']\.\/ExcelExport.jsx["'];/, 'const useExcelExport = () => {};').replace('./data/excelTable.js', new URL('../src/data/excelTable.js', import.meta.url).href);
  const Component = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default;
  const html = renderToStaticMarkup(React.createElement(Component, { leads: [lead('a'), lead('b', { ctype: '기존', buildup: '정부지원A' }), lead('missing', { contractAt: '' })], products, range, periodLabel: '2026년 9월' }));
  for (const text of ['빌드업별 판매 현황', '판매 계약', '계약 목록', '2건', '계약일 미확인 1건', '₩2,200,000', '지원사업 관리', '신규', '기존']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes('전환율'));
  assert.ok(source.includes('openLead?.(row.lead.id)'));
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const view = main.slice(main.indexOf('function ProductsView() {'), main.indexOf('function SettingsView() {'));
  assert.ok(view.includes('ProductSalesOverview'));
  assert.ok(view.includes('fieldset disabled={readOnly}'));
  assert.ok(!view.includes('premeetingDoneAt || l.createdAt'));
});
