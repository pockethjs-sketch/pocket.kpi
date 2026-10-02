import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { contractRoasRows, contractRoasByType } from '../src/data/performanceMetrics.js';

const range = ['2026-09-01', '2026-09-30'];
const lead = (id, extra = {}) => ({ id, company: '합성 기업 ' + id, status: '계약 완료', contractAt: '2026-09-10', createdAt: '2026-08-10', channel: '메타·인스타 퍼포먼스', ctype: '신규', contractAmount: 1100000, ...extra });
const leads = [lead('a'), lead('b', { ctype: '기존', contractAmount: 0, payments: [{ amount: '500000' }, { amount: 600000, paidConfirmed: true }] }), lead('old', { contractAt: '2026-08-31' }), lead('pending', { status: '프리미팅 완료' }), lead('zero', { channel: '기타', contractAmount: 0 }), lead('google', { channel: 'GOOGLE', contractAmount: 2000000 })];

test('drilldown rows reconcile with table numerator and keep contract-date rather than inflow/payment cohort', () => {
  const before = JSON.stringify(leads);
  for (const filtered of [leads, leads.filter(l => l.channel.includes('메타')), leads.filter(l => l.channel === 'GOOGLE'), []]) {
    const rows = contractRoasRows(filtered, range);
    const summary = contractRoasByType(filtered, range, 500000);
    assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), summary.amount);
    assert.equal(summary.totalRoas, Math.round(summary.amount / 500000 * 100));
  }
  assert.deepEqual(contractRoasRows(leads, range).map(row => row.lead.id), ['a', 'b', 'zero', 'google']);
  assert.equal(contractRoasRows(leads, range)[1].amount, 1100000);
  assert.equal(contractRoasRows(leads, range)[1].customerType, '기존');
  assert.equal(contractRoasRows(leads, null).length, 5);
  assert.equal(JSON.stringify(leads), before);
});

const component = readFileSync(new URL('../src/ChannelRoasDetails.jsx', import.meta.url), 'utf8').replace("import React from 'react';", '').replace('export default function', 'function');
const { code } = await transformWithOxc(component, 'ChannelRoasDetails.jsx', { jsx: { runtime: 'classic' } });
const Details = new Function('React', code + '\nreturn ChannelRoasDetails;')(React);
test('production details render exact amounts, company/channel/type/date and unknown-cost explanation', () => {
  const rows = contractRoasRows(leads, range);
  const html = renderToStaticMarkup(React.createElement(Details, { rows, spend: 1000000, roas: 420, channel: '전체', periodLabel: '2026년 9월', onOpenLead: () => {} }));
  for (const value of ['4,200,000원', '1,000,000원', '420%', '합성 기업 a', '메타·인스타 퍼포먼스', '기존', '2026-09-10', '계약금액', '실입금액 기준이 아니며']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('합성 기업 old'));
  const empty = renderToStaticMarkup(React.createElement(Details, { rows: [], spend: null, roas: null, channel: '기타', periodLabel: '', onOpenLead: () => {} }));
  assert.ok(empty.includes('산출 불가'));
  assert.ok(empty.includes('계약 완료 기업이 없습니다'));
});

test('company action opens only selected ID and does not mutate source rows', () => {
  const opened = [];
  const props = { rows: contractRoasRows(leads, range), spend: 100, roas: 4200000, channel: '전체', periodLabel: '', onOpenLead: id => opened.push(id) };
  const tree = Details(props);
  const nodes = [];
  const visit = value => { if (Array.isArray(value)) return value.forEach(visit); if (!value?.props) return; nodes.push(value); visit(value.props.children); };
  visit(tree);
  const button = nodes.find(node => node.type === 'button' && node.props.children === '합성 기업 a');
  button.props.onClick();
  assert.deepEqual(opened, ['a']);
});

test('marketing channel and total buttons share current channel/date inputs with modal and close before opening a lead', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const view = source.slice(source.indexOf('function MarketingHubView()'), source.indexOf('function PremeetingHubView()'));
  assert.match(view, /onClick=\{\(\) => setRoasChannel\(x.name\)\}/);
  assert.match(view, /onClick=\{\(\) => setRoasChannel\("전체"\)\}/);
  assert.match(view, /channelGroupName\(lead.channel\) === roasChannel/);
  assert.match(view, /contractRoasRows\(roasDetailLeads, r\)/);
  assert.match(view, /contractRoasByType\(roasDetailLeads, r, roasDetailSpend\)/);
  assert.match(view, /setRoasChannel\(null\); openLead\(id\)/);
  assert.ok(!view.includes('fetch('));
});
