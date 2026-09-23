import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterNotionReceivables, notionReceivableSummary, notionSourceUrl } from '../src/data/notionReceivables.js';

const records = [
  { source_key: 'n-1', company: '가상회사 A', request_status: '완료', payment_status: '입금전', deposit_text: '선금 확인', balance_text: '잔금 확인', projects_text: '브랜딩', freelancer: '담당 A' },
  { source_key: 'n-2', company: '가상회사 B', request_status: '지급요청 전', payment_status: '입금완료', projects_text: '개발', notes: '테스트 메모' },
  { source_key: 'n-3', company: '', request_status: '완료', payment_status: '입금완료' },
];

test('request completion and payment completion remain independent', () => {
  assert.deepEqual(notionReceivableSummary(records), { count: 3, missingCompany: 1, requestDonePaymentOpen: 1 });
});

test('search and status filters apply without changing the source rows', () => {
  const before = JSON.stringify(records);
  assert.equal(filterNotionReceivables(records, { query: '브랜딩', requestStatus: '완료', paymentStatus: '입금전' }).length, 1);
  assert.equal(filterNotionReceivables(records, { query: '테스트 메모' })[0].source_key, 'n-2');
  assert.equal(JSON.stringify(records), before);
});

test('only HTTPS Notion pages can be opened as source links', () => {
  assert.match(notionSourceUrl('https://app.notion.com/p/abc'), /^https:/);
  assert.equal(notionSourceUrl('javascript:alert(1)'), '');
  assert.equal(notionSourceUrl('https://example.com/p/abc'), '');
});

test('API is employee-gated, organization-scoped, and never returns raw payload', () => {
  const api = readFileSync(new URL('../supabase/functions/kpi-domain-api/index.ts', import.meta.url), 'utf8');
  const action = api.slice(api.indexOf('if (action === "notion_receivables")'), api.indexOf('if (action === "crm")'));
  assert.match(api, /readActions = new Set\([^\n]*"notion_receivables"/);
  assert.match(action, /\.eq\("organization_id", organizationId\)/);
  assert.doesNotMatch(action, /select\("\*"\)/);
  assert.doesNotMatch(action.match(/const columns = "([^"]+)"/)?.[1] || '', /raw_payload/);
  assert.match(action, /\.range\(offset, offset \+ 499\)/);
  const migration = readFileSync(new URL('../supabase/migrations/20260923060000_notion_receivables_least_privilege.sql', import.meta.url), 'utf8');
  assert.match(migration, /revoke all on table public\.notion_contract_payment_records from public, anon, authenticated/);
});
