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
