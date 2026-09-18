import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { REVENUE_GROUPS, revenueAnswer, classifyRevenueAnswer, summarizeRevenueQuality } from '../src/data/leadRevenueQuality.js';
import { dailyStageActivity } from '../src/data/performanceMetrics.js';

test('groups the three early-stage answers without equating missing with zero', () => {
  for (const value of ['없음', '매출 없음', '예비', '예비_창업자', '제품/서비스_제작_단계', '서비스 제작단계', '0원']) assert.equal(classifyRevenueAnswer(value), 'early', value);
  for (const value of ['', null, undefined, '-', '미정']) assert.equal(classifyRevenueAnswer(value), 'missing');
});

test('groups explicit revenue answers and avoids double counting ten-billion-won units', () => {
  for (const value of ['1억~5억', '1~5억', '발생_매출_3억_이상', '3억원 이상', '1억원', '10,000만원']) assert.equal(classifyRevenueAnswer(value), 'one', value);
  for (const value of ['10억 이상', '50억초과', '20~50억', '10억원', '1,000,000,000원']) assert.equal(classifyRevenueAnswer(value), 'ten', value);
  for (const value of ['5~20억', '5억미만', '1억 이하', '제품/서비스로 인한 매출 발생', '연환산 12억', '월 매출 1억', '8천만원', '투자금 10억', '매출없음 / 10억이상', '20~5억']) assert.equal(classifyRevenueAnswer(value), 'uncertain', value);
});

test('uses CRM raw answer before inferred sales and never TM score/contract value', () => {
  assert.equal(revenueAnswer({ crmSheet: { annualSalesRaw: '예비_창업자', annualSales: '연환산 12억' } }), '예비_창업자');
  assert.equal(revenueAnswer({ crmQuality: { values: { annua_sales_structured: '10억 이상' } } }), '10억 이상');
  assert.equal(revenueAnswer({ grade: '상', contractAmount: 1e9, score: { tm: { items: { rev: 3 } } } }), '');
});

test('counts match the chart population, preserve weekends, date range and customer filtering', () => {
  const make = (id, date, answer, ctype = '신규') => ({ id, createdAt: date, ctype, crmSheet: { annualSalesRaw: answer } });
  const leads = [make('a', '2026-09-18', '없음'), make('b', '2026-09-19', '3억 이상'), make('c', '2026-09-20', '50억초과'), make('d', '2026-09-21', ''), make('e', '2026-09-21', '5~20억'), make('f', '2026-08-18', '없음'), make('g', '2026-09-22', '없음'), make('h', '2026-09-18', '없음', '기존')];
  const original = JSON.stringify(leads);
  const days = dailyStageActivity(leads.filter(l => l.ctype === '신규'), 'marketing', '2026-09', '2026-09-21', ['2026-09-18', '2026-09-21']);
  const result = summarizeRevenueQuality(days.flatMap(day => day.entries.map(entry => entry.lead)));
  assert.deepEqual([result.early, result.one, result.ten, result.missing, result.uncertain, result.total], [1, 1, 1, 1, 1, 5]);
  assert.equal(result.total, days.reduce((sum, day) => sum + day.count, 0));
  assert.equal(summarizeRevenueQuality(days.find(day => day.date === '2026-09-19').entries.map(entry => entry.lead)).one, 1);
  assert.equal(JSON.stringify(leads), original);
});

const source = readFileSync(new URL('../src/LeadRevenueQuality.jsx', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'LeadRevenueQuality.jsx', { jsx: { runtime: 'classic' } });
const Component = new Function('React', 'REVENUE_GROUPS', 'summarizeRevenueQuality', code.replace(/^import .*;$/gm, '').replace('export default ', '') + '\nreturn LeadRevenueQuality;')(React, REVENUE_GROUPS, summarizeRevenueQuality);

test('renders three cards, month/day counts, missing and ambiguous answers safely', () => {
  const leads = [{ crmSheet: { annualSalesRaw: '3억 이상' } }, { crmSheet: { annualSalesRaw: '<script>10억</script>' } }, {}];
  const html = renderToStaticMarkup(React.createElement(Component, { leads, label: '2026-09 · 신규', dayLeads: [leads[0]], dayLabel: '2026-09-18' }));
  for (const group of REVENUE_GROUPS) assert.ok(html.includes(group.label));
  assert.match(html, /주말 포함 3건/);
  assert.match(html, /2026-09-18 · 1건/);
  assert.match(html, /매출 미입력 1건 · 분류 확인 필요 1건/);
  assert.doesNotMatch(html, /<script>|NaN|Infinity/);
  assert.match(html, /&lt;script&gt;/);
  const empty = renderToStaticMarkup(React.createElement(Component, { leads: [], label: '빈 기간' }));
  assert.match(empty, /주말 포함 0건/);
});

test('integration only inserts revenue summary under marketing daily chart', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /metricStage.id === "marketing" && <LeadRevenueQuality leads=\{dailyCounts.flatMap/);
  assert.ok(main.indexOf('<DailyActivityChart') < main.indexOf('<LeadRevenueQuality'));
});
