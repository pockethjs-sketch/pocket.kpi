import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { dailyStageActivity, weekdayActivity } from '../src/data/performanceMetrics.js';

const source = readFileSync(new URL('../src/DailyActivityChart.jsx', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'DailyActivityChart.jsx', { jsx: { runtime: 'classic' } });
const Chart = new Function('React', code.replace(/import React from "react";/, '').replace('export default ', '') + '\nreturn DailyActivityChart;')(React);
const days = weekdayActivity(dailyStageActivity([
  { createdAt: '2026-09-04' }, { createdAt: '2026-09-05' }, { createdAt: '2026-09-06' }, { createdAt: '2026-09-07' },
], 'marketing', '2026-09', '2026-09-07'));

test('display hides Saturdays and Sundays without deleting activities or zero weekdays', () => {
  assert.deepEqual(days.map(day => day.date), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']);
  assert.equal(days[0].count, 0);
  const original = [{ date: '2026-09-05', count: 8 }, { date: '2026-09-07', count: 2 }];
  assert.equal(weekdayActivity(original)[0], original[1]);
  assert.equal(original.reduce((sum, day) => sum + day.count, 0), 10);
  assert.deepEqual(weekdayActivity([{ date: '2026-08-01' }, { date: '2026-08-02' }]), []);
});

test('all stages render lines, preserve date selection and separate attendance into two series', () => {
  for (const stage of ['marketing', 'contract', 'pre']) {
    const html = renderToStaticMarkup(React.createElement(Chart, { days, stage, label: '9월', selectedDate: '2026-09-07', onSelect() {} }));
    assert.equal((html.match(/<polyline /g) || []).length, stage === 'pre' ? 2 : 1);
    assert.equal((html.match(/role="button"/g) || []).length, 5);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    assert.doesNotMatch(html, /2026-09-05|2026-09-06|NaN|Infinity/);
    if (stage === 'pre') assert.match(html, /stroke-dasharray="5 4"/);
  }
});

test('line chart points support clicks and keyboard selection, including zero days', () => {
  const selected = [];
  const tree = Chart({ days, stage: 'marketing', label: '9월', onSelect: date => selected.push(date) });
  const nodes = [];
  const walk = node => { if (!node || typeof node !== 'object') return; nodes.push(node); React.Children.forEach(node.props?.children, walk); };
  walk(tree);
  const point = nodes.find(node => node.props?.role === 'button');
  point.props.onClick();
  let prevented = false;
  point.props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.deepEqual(selected, ['2026-09-01', '2026-09-01']);
  assert.equal(prevented, true);
});

test('empty and single-day charts never generate invalid geometry', () => {
  assert.match(renderToStaticMarkup(React.createElement(Chart, { days: [] })), /표시할 평일이 없습니다/);
  const html = renderToStaticMarkup(React.createElement(Chart, { days: [days[0]], stage: 'marketing', label: '9월' }));
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /<circle /);
});
