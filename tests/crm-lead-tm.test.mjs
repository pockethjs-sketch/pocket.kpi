import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TM_ITEMS, CRM_LEAD_LIMITS, tmChecks, crmLeadView } from '../supabase/functions/_shared/crm-lead-tm.mjs';
import { validateBridgeMessage, BUILDUP_BRIDGE_OPS } from '../src/data/buildupBridge.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const api = read('../supabase/functions/kpi-buildup-api/index.ts');

test('TM diagnosis labels and choices stay identical to the KPI app', () => {
  const main = read('../src/main.jsx');
  const start = main.indexOf('const SCORE_ITEMS = [');
  const end = main.indexOf('];', start);
  const kpi = new Function('return ' + main.slice(start + 'const SCORE_ITEMS = '.length, end + 1))();
  assert.deepEqual(TM_ITEMS.map((item) => [item.key, item.label, item.opts]), kpi.map((item) => [item.key, item.label, item.opts.map((o) => o.t)]));
});

test('TM checks read choice indexes in KPI order and skip unknown or invalid values', () => {
  assert.deepEqual(tmChecks({ gov: 2, rev: 1, mvp: 7, team: '1', extra: 0 }), [
    { label: '매출', value: '연 1억 미만' }, { label: '지원사업·융자 경험', value: '수혜 1회' }]);
  assert.deepEqual(tmChecks(null), []);
});

test('the lead view carries only the TM fields — never contact details — with bounded text', () => {
  const payload = {
    id: 'crm-9001', company: '가상테크', contact: '홍길동', phone: '010-0000-0000', email: 'x@example.com',
    crmSheet: { clientNo: 9001, detailMemo: ' 통화 1차 \r\n\r\n\r\n 매출 문의   있음 ', inquiry: 'x'.repeat(CRM_LEAD_LIMITS.inquiryChars + 50), phone: '010-0000-0000', email: 'x@example.com' },
    score: { tm: { items: { rev: 2, ceo: 1 } } },
  };
  const view = crmLeadView(payload);
  assert.deepEqual(Object.keys(view).sort(), ['clientNo', 'detailMemo', 'inquiry', 'tmChecks']);
  assert.equal(view.clientNo, '9001');
  assert.equal(view.detailMemo, '통화 1차\n\n매출 문의 있음');
  assert.equal(view.inquiry.length, CRM_LEAD_LIMITS.inquiryChars + 1);
  assert.ok(view.inquiry.endsWith('…'));
  assert.deepEqual(view.tmChecks, [{ label: '매출', value: '연 1~5억' }, { label: '대표 전문성', value: '유관 경력' }]);
  assert.doesNotMatch(JSON.stringify(view), /010-0000|example\.com|홍길동|가상테크/);
  assert.equal(crmLeadView({ id: 'crm-77' }).clientNo, '77');
  assert.deepEqual(crmLeadView('nope'), { clientNo: '', detailMemo: '', inquiry: '', tmChecks: [] });
});

test('crmLead resolves one active lead of the organization from the stored schedule and returns only the view', () => {
  const action = api.slice(api.indexOf('if (action === "crmLead")'), api.indexOf('if (action === "usage")'));
  assert.ok(action.length > 200, 'crmLead action present');
  assert.ok(api.indexOf('if (action === "crmLead")') > api.indexOf('if (!canUseBuildup(access))'), 'runs after the employee checks');
  assert.match(action, /from\("buildup_premeetings"\)\.select\("crm_client_no,crm_project_no"\)\s*\.eq\("organization_id", organizationId\)\.eq\("schedule_no", scheduleNo\)/);
  assert.match(action, /from\("leads"\)\.select\("source_payload"\)\s*\.eq\("organization_id", organizationId\)\.is\("archived_at", null\)\.eq\(column, value\)\.limit\(2\)/);
  assert.match(action, /data\?\.length === 1 \? data\[0\] : null/, 'ambiguous matches are not guessed');
  assert.match(action, /lead: crmLeadView\(row\.source_payload\)/);
  assert.match(action, /\^\[0-9\]\{1,20\}\$/);
});

test('the bridge forwards crmLead with a schedule number (and optional project number) only', () => {
  assert.ok(BUILDUP_BRIDGE_OPS.includes('crmLead'));
  assert.ok(validateBridgeMessage({ id: 'r1', op: 'crmLead', args: { scheduleNo: '24238' } }));
  assert.ok(validateBridgeMessage({ id: 'r2', op: 'crmLead', args: { scheduleNo: '24238', projectNo: '18800' } }));
  for (const args of [{}, { scheduleNo: 'abc' }, { scheduleNo: '1', projectNo: 'x' }, { scheduleNo: '1', clientNo: '2' }, { scheduleNo: '1'.repeat(21) }]) {
    assert.equal(validateBridgeMessage({ id: 'r3', op: 'crmLead', args }), null, JSON.stringify(args));
  }
});
