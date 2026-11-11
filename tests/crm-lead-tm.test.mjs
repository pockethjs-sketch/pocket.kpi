import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TM_ITEMS, CRM_LEAD_LIMITS, tmChecks, crmLeadView, memoText, latestRawLead } from '../supabase/functions/_shared/crm-lead-tm.mjs';
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
  assert.match(action, /lead: crmLeadView\(row\?\.source_payload \?\? null, raw\)/);
  // Newest stored CRM inquiry records of the same organization, by client and by project number (plain equality
  // filters, as the lead lookups use) — memo, inquiry, client number and time only.
  assert.match(action, /from\("crm_raw_records"\)\s*\.select\("client_no:payload->>client_no,client_memo:payload->>client_memo,iciq_content:payload->>iciq_content,last_seen_at"\)\s*\.eq\("organization_id", organizationId\)\.eq\("record_type", "LEAD"\)\.eq\(column, value\)\s*\.order\("last_seen_at", \{ ascending: false \}\)\.limit\(CRM_LEAD_LIMITS\.rawRows\)/);
  assert.match(action, /clientNo \? rawRows\("payload->>client_no", clientNo\) : Promise\.resolve\(\[\]\)/);
  assert.match(action, /project \? rawRows\("external_id", project\) : Promise\.resolve\(\[\]\)/);
  assert.match(action, /raw = latestRawLead\(\[\.\.\.byClient, \.\.\.byProject\]\)/);
  assert.match(action, /catch \{ return reply\(req, \{ error: "crm_lead_read_failed" \}, 500\); \}\s*if \(!row && !raw\)/);
  assert.doesNotMatch(action, /\.or\(/, 'no hand-built filter strings');
  assert.match(action, /const digitsOnly = \(value: unknown\) => \/\^\[0-9\]\{1,20\}\$\/\.test/, 'numbers used in the lookups are digits only');
  assert.match(action, /if \(!row && !raw\) return reply\(req, \{ ok: true, found: false \}\)/);
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

test('CRM memo HTML becomes readable lines (lists, breaks, entities) without scripts or tags', () => {
  const html = '<p><strong>기본 정보</strong></p><ul><li>회사명: 통화에서 언급되지 않음</li><li>응답자:&nbsp;대표 본인</li></ul>'
    + '<p>사업/BM 현황<br>바이오 원료 &amp; 화장품</p><script>alert(1)</script><div>스코어링 항목</div><p>&#54620;&#xAE00; &lt;b&gt; &bogus;</p>';
  assert.equal(memoText(html), '기본 정보\n\n- 회사명: 통화에서 언급되지 않음\n- 응답자: 대표 본인\n\n사업/BM 현황\n바이오 원료 & 화장품\n\n스코어링 항목\n\n한글 <b> &bogus;');
  assert.equal(memoText(''), '');
  assert.equal(memoText(null), '');
  assert.equal(memoText('<p>' + 'x'.repeat(50) + '</p>', 10), 'x'.repeat(10) + '…');
  // Inline formatting adds no spaces (as on screen); cells are spaced; comments go; plain-text memos keep "<" text.
  assert.equal(memoText('<p><strong>매출</strong>액<span style="color:red">: 3억</span></p>'), '매출액: 3억');
  assert.equal(memoText('<table><tr><td>매출</td><td>3억</td></tr><tr><td>인원</td><td>4명</td></tr></table>'), '매출 3억\n인원 4명');
  assert.equal(memoText('<!-- 편집기 메모 --><p>본문</p><hr><p>끝</p>'), '본문\n\n끝');
  assert.equal(memoText('매출 <1억, 목표 >5억\n팀 2명'), '매출 <1억, 목표 >5억\n팀 2명');
});

test('the newest stored CRM record with a memo is preferred over the (older) KPI lead memo', () => {
  const rows = [
    { client_no: '48000', client_memo: '', iciq_content: '', last_seen_at: '2026-10-20T00:02:00+00:00' },
    { client_no: '48000', client_memo: '<p>예전</p>', last_seen_at: '2026-10-01T00:02:00+00:00' },
    { client_no: '48000', client_memo: '<p>최신 TM 메모</p><ul><li>2027 TIPS 준비</li></ul>', iciq_content: null, last_seen_at: '2026-10-16T00:02:00+00:00' },
  ];
  // Client-number and project-number lookups are merged: the most recently seen row with a memo wins, whatever the order or repeats.
  const raw = latestRawLead([rows[1], rows[0], rows[2], rows[1]]);
  assert.equal(raw, rows[2]);
  assert.equal(latestRawLead([{ client_memo: '<p>시간 없음</p>' }, rows[1]]), rows[1]);
  assert.equal(latestRawLead([{ iciq_content: '<p>a</p>' }, { iciq_content: '<p>b</p>' }]).iciq_content, '<p>a</p>');
  assert.equal(latestRawLead([rows[0], null, 'x']), null);
  assert.equal(latestRawLead([]), null);
  assert.equal(latestRawLead('x'), null);
  const lead = { id: 'crm-48000', crmSheet: { clientNo: 48000, detailMemo: '', inquiry: '처음 문의' }, score: { tm: { items: { ceo: 2 } } } };
  const view = crmLeadView(lead, raw);
  assert.deepEqual(view, { clientNo: '48000', detailMemo: '최신 TM 메모\n\n- 2027 TIPS 준비', inquiry: '처음 문의', tmChecks: [{ label: '대표 전문성', value: '해당 분야 전문가' }] });
  // No KPI lead at all: the stored CRM record alone is enough; still only the four fields.
  const only = crmLeadView(null, { client_no: '48000', client_memo: '<p>메모</p>', iciq_content: '<p>문의</p>', client_email: 'x@example.com', client_contact: [{ number: '010-0000-0000' }] });
  assert.deepEqual(only, { clientNo: '48000', detailMemo: '메모', inquiry: '문의', tmChecks: [] });
  // Without a stored CRM memo the KPI lead memo is used as before.
  assert.equal(crmLeadView({ crmSheet: { clientNo: 1, detailMemo: '리드 메모' } }, null).detailMemo, '리드 메모');
});
