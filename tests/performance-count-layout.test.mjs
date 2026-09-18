import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { absoluteCountChange } from '../src/data/performanceMetrics.js';

test('count card renders actual count then signed delta before the separate goal', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('  const Criterion ='), source.indexOf('  const formulaFor ='));
  const { code } = await transformWithOxc(block, 'Criterion.jsx', { jsx: { runtime: 'classic' } });
  const Criterion = new Function('React', 'DailyDelta', 'ChevronRight', code + '\nreturn Criterion;')(React,
    props => React.createElement('span', {}, absoluteCountChange(props.current, props.previous).text), () => null);
  const html = renderToStaticMarkup(React.createElement(Criterion, {
    title: '절대값', label: '유입 DB', value: '126건', valueSuffix: '/ 500', state: 'bad',
    delta: { current: 126, previous: 113, absolute: true }, target: '목표 500건 이상',
  }));
  assert.ok(html.indexOf('126건') < html.indexOf('+13건'));
  assert.ok(html.indexOf('+13건') < html.indexOf('/ 500'));
  assert.doesNotMatch(html, /%/);
  assert.match(html, /inline-flex items-center gap-1 whitespace-nowrap/);
});

test('contract cost drilldown renders every contract with amount and new/existing type', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const costBlock = source.slice(source.indexOf('{metricOpen.type === "cost" &&'), source.indexOf('function MarketingHubView'));
  assert.match(costBlock, /rows=\{metricRows\} detail=\{metricStage\.id === "contract" \? "contract" : undefined\}/);
  const block = source.slice(source.indexOf('  const PopupLeadList ='), source.indexOf('  const marketingLogs =', source.indexOf('  const PopupLeadList =')));
  const { code } = await transformWithOxc(block, 'PopupLeadList.jsx', { jsx: { runtime: 'classic' } });
  const dependencies = {
    React, contractAmountOf: lead => lead.contractAmount || 0, actualPaid: () => 0,
    buildupLabelsOf: () => ['AX 개발'], payRows: () => [], fmtK: n => n.toLocaleString('en-US'), fmtDate: d => d,
  };
  const Popup = new Function(...Object.keys(dependencies), code + '\nreturn PopupLeadList;')(...Object.values(dependencies));
  const rows = [
    { id: 'new', company: '신규 계약 예시', ctype: '신규', contractAmount: 25000000, contractAt: '2026-09-07' },
    { id: 'existing', company: '기존 계약 예시', ctype: '기존', contractAmount: 18000000, contractAt: '2026-09-08' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: String(i), company: '추가계약' + i, ctype: '신규', contractAmount: 100 })),
  ];
  const html = renderToStaticMarkup(React.createElement(Popup, { title: '계약당 비용 계산 대상 기업', rows, detail: 'contract' }));
  assert.equal((html.match(/<button /g) || []).length, 12);
  for (const text of ['신규', '기존', '25,000,000', '18,000,000', '계약금액', '실제 입금', '미수', '추가계약9']) assert.ok(html.includes(text), text);
});

test('a September contract with an August meeting is in August premeeting companies, not September', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const DEAL_STAGE_STATUSES ='), source.indexOf('const SSTYLE ='));
  const isIncluded = new Function('inR', block + '\nreturn isPremeetingCompanyInRange;')((date, range) => !range || (!!date && date >= range[0] && date <= range[1]));
  const lead = { status: '계약 완료', ctype: '신규', createdAt: '2026-09-07', contractAt: '2026-09-07', premeetingAt: '2026-08-14', premeetingDoneAt: '2026-08-14', bookedAt: '2026-08-14' };
  assert.equal(isIncluded(lead, ['2026-08-01', '2026-08-31']), true);
  assert.equal(isIncluded(lead, ['2026-09-01', '2026-09-30']), false);
  assert.equal(isIncluded(lead, null), true);
});
