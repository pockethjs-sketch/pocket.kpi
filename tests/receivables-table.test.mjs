import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import * as Icons from 'lucide-react';
import * as domain from '../src/data/notionReceivables.js';
const icons = Object.fromEntries(['AlignLeft', 'CalendarDays', 'Circle', 'CircleChevronDown', 'FileText', 'List', 'LoaderCircle', 'Type', 'ExternalLink', 'RefreshCw', 'Archive', 'Pencil', 'Trash2', 'Plus'].map(name => [name, Icons[name]]));

async function compile(source, exports, dependencies) {
  const plain = source.replace(/^import .*;\r?\n/gm, '').replaceAll('export default ', '').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ');
  const { code } = await transformWithOxc(plain, 'test.jsx', { jsx: { runtime: 'classic' } });
  return new Function(...Object.keys(dependencies), code + '\nreturn {' + exports.join(',') + '};')(...Object.values(dependencies));
}
const source = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
const table = await compile(source('ReceivablesTable.jsx'), ['ReceivablesTable', 'ReceivableTag', 'ReceivableStatus', 'ReceivableCompany', 'NOTION_RECEIVABLE_COLUMNS', 'LEDGER_RECEIVABLE_COLUMNS'], { React, ...icons });
const records = Array.from({ length: 35 }, (_, index) => ({
  source_key: 'synthetic-' + index, company: '테스트 업체 ' + index, contract_date: '2026-09-01', freelancer: '담당 A',
  projects_text: '투자유치A\n홈페이지', deposit_text: '선금 50%: 550,000원\n(지급 완료)', balance_text: '잔금 50%: 550,000원\n다음 달 지급 예정',
  notes: '첫 번째 확인사항\n두 번째 확인사항', request_status: '완료', payment_status: index ? '입금전' : '입금완료',
  source_page_reference: index ? 'javascript:alert(1)' : 'https://www.notion.so/synthetic',
}));
let states, cursor, fetchResult;
const { NotionReceivables } = await compile(source('NotionReceivables.jsx'), ['NotionReceivables'], {
  React, ...table, ...domain,
  useState: initial => { const index = cursor++; if (states[index] === undefined) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
  useEffect() {}, useMemo: fn => fn(),
  window: { crmFetchNotionReceivables: async () => { if (fetchResult instanceof Error) throw fetchResult; return fetchResult; } },
});
function reset() { states = [records, 'ready', '', '2026-09-28T00:00:00Z', '', 'all', '', '', 30]; }
function tree() { cursor = 0; return NotionReceivables(); }
function html() { return renderToStaticMarkup(tree()); }
function elements(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(child => elements(child, predicate));
  return [...(predicate(element) ? [element] : []), ...elements(element.props?.children, predicate)];
}
function find(predicate) { return elements(tree(), predicate)[0]; }

test('Notion table exposes all ten reference columns and full multiline text without expanding a row', () => {
  reset(); const rendered = html();
  assert.equal((rendered.match(/scope="col"/g) || []).length, 10);
  assert.deepEqual(table.NOTION_RECEIVABLE_COLUMNS.map(column => column.label), ['계약진행일', '업체', '프리', '가이드', '선금 금액', '잔금금액', '프로젝트', '특이사항', '상태', '입금']);
  assert.match(rendered, /첫 번째 확인사항\n두 번째 확인사항/);
  assert.match(rendered, /다음 달 지급 예정/);
  assert.match(rendered, /현재 이관 API에 가이드 정보가 없습니다/);
  assert.doesNotMatch(rendered.slice(rendered.indexOf('<tbody>')), /<details|truncate|line-clamp|javascript:/);
  assert.equal((rendered.match(/<tbody>.*?<\/tbody>/s)?.[0].match(/<tr>/g) || []).length, 30);
  assert.match(rendered, /target="_blank" rel="noopener noreferrer"/);
});

test('upper classification, search, advanced filters and more button still work', () => {
  reset(); const original = JSON.stringify(records);
  find(node => node.type === 'button' && node.props.children?.[0]?.props?.children === '입금 완료').props.onClick();
  assert.match(html(), /테스트 업체 0/);
  assert.doesNotMatch(html(), /테스트 업체 1</);
  reset(); find(node => node.props['aria-label'] === '이관 자료 검색').props.onChange({ target: { value: '테스트 업체 34' } });
  assert.match(html(), /테스트 업체 34/); assert.doesNotMatch(html(), /테스트 업체 0</);
  reset(); find(node => node.props['aria-label'] === '입금 상태 필터').props.onChange({ target: { value: '입금완료' } });
  assert.match(html(), /테스트 업체 0/); assert.doesNotMatch(html(), /테스트 업체 1</);
  reset(); find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === '더 보기 · 남은 ').props.onClick();
  assert.match(html(), /테스트 업체 34/);
  assert.equal(JSON.stringify(records), original);
});

test('request complete is not shown as paid; unknown values remain missing instead of zero', () => {
  const statusHtml = value => renderToStaticMarkup(React.createElement(table.ReceivableStatus, value));
  assert.doesNotMatch(statusHtml({ value: '완료' }), /receivables-status--paid/);
  assert.doesNotMatch(statusHtml({ value: '입금전', payment: true }), /receivables-status--paid/);
  assert.match(statusHtml({ value: '카결완료', payment: true }), /receivables-status--paid/);
  reset(); states[0] = [{ source_key: 'empty', company: '' }];
  const rendered = html(); assert.match(rendered, /업체명 미입력/); assert.doesNotMatch(rendered, /0원/);
  states[0] = []; assert.match(html(), /colSpan="10"|colspan="10"/); assert.match(html(), /조건에 맞는 자료가 없습니다/);
});

test('refresh failures retain last good rows; successful reload replaces them', async () => {
  reset(); fetchResult = new Error('read_failed');
  await find(node => node.type === 'button' && node.props.children === '새로고침').props.onClick();
  assert.match(html(), /마지막 조회 결과를 유지합니다/); assert.match(html(), /테스트 업체 0/);
  fetchResult = { ok: true, count: 1, rows: [records[34]], latestImportedAt: '2026-09-28T01:00:00Z' };
  await find(node => node.type === 'button' && node.props.children === '새로고침').props.onClick();
  assert.match(html(), /테스트 업체 34/); assert.doesNotMatch(html(), /조회 실패/);
});

const main = source('main.jsx');
const start = main.indexOf('<ReceivablesTable columns={LEDGER_RECEIVABLE_COLUMNS}');
const end = main.indexOf('</ReceivablesTable>', start) + '</ReceivablesTable>'.length;
const ledgerMarkup = main.slice(start, end);
const sampleLead = { id: 'fake-ledger', company: '가상 원장 업체', contractAt: '2026-09-07', vendorNote: '합성 메모', payments: [] };
let ledgerEvents = [];
const { Ledger } = await compile('function Ledger() { return (' + ledgerMarkup + '); }', ['Ledger'], {
  React, ...icons, ...table,
  rows: [{ lead: sampleLead, addedDay: '2026-09-08' }], ledgerStage: 'inProgress',
  statusOf: () => '완료', paymentStateOf: () => '입금전', noteOf: lead => lead.vendorNote, noteBlocksOf: note => [note], fmtDate: value => value,
  preOwnerOf: () => '담당 A', guideOwnerOf: () => '담당 B', projectLabelsOf: () => ['투자유치A'],
  paymentCell: (lead, kind) => React.createElement('td', { 'data-payment-kind': kind }, kind),
  openLead: id => ledgerEvents.push(['open', id]), setLeadArchived: (lead, value) => ledgerEvents.push(['archive', lead.id, value]),
  editingNoteId: null, editingNoteBlock: null, setEditingNoteId() {}, setEditingNoteBlock() {}, beginNoteEdit: lead => ledgerEvents.push(['note', lead.id]),
  deleteNoteBlock: (lead, index) => ledgerEvents.push(['deleteNote', lead.id, index]),
  DangerBtn: ({ children }) => React.createElement('button', null, children),
  STATUS_OPTIONS: ['지급요청 전', '완료'], PAYMENT_OPTIONS: ['입금전', '입금완료'],
  changeLeadField: (lead, key, value) => ledgerEvents.push([key, lead.id, value]),
});

test('operational ledger has eleven columns, separate date/project and preserves middle payments', () => {
  const rendered = renderToStaticMarkup(React.createElement(Ledger));
  assert.equal((rendered.match(/scope="col"/g) || []).length, 11);
  assert.match(rendered, /data-payment-kind="middle"/);
  assert.match(rendered, /2026-09-07/); assert.match(rendered, /투자유치A/);
  assert.match(rendered, /합성 메모/); assert.match(rendered, /요청 상태/); assert.match(rendered, /입금 상태/);
});

test('operational table connects edits, note add, archive and company opening to existing handlers', () => {
  ledgerEvents = []; const value = Ledger();
  elements(value, node => node.type === table.ReceivableCompany)[0].props.onClick();
  elements(value, node => node.type === 'button' && node.props.children?.[1] === '보관으로 이동')[0].props.onClick();
  elements(value, node => node.type === 'button' && node.props.children?.[1] === '기록 추가')[0].props.onClick();
  for (const node of elements(value, node => node.type === 'select')) node.props.onChange({ target: { value: '검증 값' } });
  assert.deepEqual(ledgerEvents, [['open', sampleLead.id], ['archive', sampleLead.id, true], ['note', sampleLead.id], ['vendorImportStatus', sampleLead.id, '검증 값'], ['vendorImportPaymentState', sampleLead.id, '검증 값']]);
});
