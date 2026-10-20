import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREMEETING_DAYS, kstDay, premeetingWindow, premeetingQuery, clientFacts, normalizePremeeting, normalizePremeetings,
  premeetingItem, premeetingSync,
} from '../supabase/functions/_shared/premeeting-upcoming.mjs';
import { validateBridgeMessage, createBuildupBridge } from '../src/data/buildupBridge.js';
import { cleanSummary } from '../supabase/functions/_shared/buildup-access.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fetcher = read('../supabase/functions/kpi-buildup-premeetings/index.ts');
const api = read('../supabase/functions/kpi-buildup-api/index.ts');
const crmSync = read('../supabase/functions/kpi-crm-sync/index.ts');
const migration = ['20261020104259_buildup_upcoming_premeetings_tables', '20261020104325_buildup_upcoming_premeetings_privileges',
  '20261020104416_buildup_store_premeetings_function', '20261020104429_buildup_premeetings_schedule']
  .map((name) => read(`../supabase/migrations/${name}.sql`)).join('\n');
const config = read('../supabase/config.toml');

// Synthetic CRM schedule rows only (no real customers).
const WINDOW = { start: '2026-10-20', end: '2026-11-19' };
const row = (extra = {}) => ({
  ms_no: 9001, mr_type: 1, mr_checked: 0, mr_way: 'visit', start_dt: '2026-10-21T05:00:00.000Z', end_dt: '2026-10-21T06:00:00.000Z',
  client_rep_name: ' 가상상사 ', client_name: '홍길동', client_contact: [{ name: '홍길동', number: '010-0000-0000' }], client_email: 'ceo@example.invalid',
  mr_name: '[프리미팅] 가상상사', proj_no: 77, client_no: 55, creater_user: '김티엠', mr_comment: '  IR 자료 지참  ',
  managers: [{ emp_no: 1, emp_name: '박영업' }, { emp_no: 2, emp_name: '이보조' }],
  client_info: { annua_sales: '5억미만', expected_sales: '5~20억', member_of_total: '1~10명', need_buildup: '투자유치', need_buildup_direct: 'undefined',
    business: '가상 구독 서비스', homepage: 'https://example.invalid', sectors_etc: '', cust_founded: '직접입력', cust_founded_direct: '2024-03',
    financing_experience: ['정부지원', '없음'], addr: '서울 어딘가 1', addr_detail: '101호', contact_time: '오전' },
  ...extra,
});

test('the window is today (KST) through +30 days and uses the same CRM calendar query as the KPI sync', () => {
  assert.equal(PREMEETING_DAYS, 30);
  assert.equal(kstDay(new Date('2026-10-20T15:30:00Z')), '2026-10-21');
  assert.deepEqual(premeetingWindow(new Date('2026-10-19T23:00:00Z')), { start: '2026-10-20', end: '2026-11-19' });
  const query = premeetingQuery(WINDOW);
  assert.match(query, /^offset=0&limit=1000&state=1&page=schedule&start_dt=2026-10-20T00%3A00%3A00%2B09%3A00&end_dt=2026-11-19T23%3A59%3A59%2B09%3A00$/);
  assert.match(crmSync, /crm\/v3\/mr_schedules\?offset=0&limit=1000&state=1&page=schedule/);
  assert.match(fetcher, /crm\/v3\/mr_schedules\?/);
});

test('a CRM premeeting becomes a display row without phone, e-mail or address', () => {
  const item = normalizePremeeting(row(), WINDOW);
  assert.deepEqual(item, {
    scheduleNo: '9001', meetingAt: '2026-10-21T05:00:00.000Z', meetingEndAt: '2026-10-21T06:00:00.000Z', meetingDay: '2026-10-21', way: 'visit',
    company: '가상상사', contact: '홍길동', salesOwner: '박영업', managers: ['박영업', '이보조'], bookedBy: '김티엠', projectNo: '77', clientNo: '55',
    visited: false, note: 'IR 자료 지참',
    client: { annualSales: '5억미만', expectedSales: '5~20억', members: '1~10명', needBuildup: '투자유치', business: '가상 구독 서비스',
      homepage: 'https://example.invalid', founded: '2024-03', financing: ['정부지원'] },
  });
  const text = JSON.stringify(item);
  for (const secret of ['010-0000-0000', 'ceo@example.invalid', '서울 어딘가', '101호', '오전']) assert.ok(!text.includes(secret), secret);
});

test('company, contact and way fall back like the KPI projection; non-premeetings and bad rows are skipped', () => {
  assert.equal(normalizePremeeting(row({ client_rep_name: '', client_name: '' }), WINDOW).company, '[프리미팅] 가상상사');
  assert.equal(normalizePremeeting(row({ client_rep_name: null, client_name: null, mr_name: null }), WINDOW).company, '(업체명 미등록)');
  assert.equal(normalizePremeeting(row({ client_name: null }), WINDOW).contact, '홍길동');
  assert.equal(normalizePremeeting(row({ mr_way: 'teleport' }), WINDOW).way, '');
  assert.equal(normalizePremeeting(row({ mr_checked: 1 }), WINDOW).visited, true);
  assert.equal(normalizePremeeting(row({ mr_type: 2 }), WINDOW), null);
  assert.equal(normalizePremeeting(row({ ms_no: 'x1' }), WINDOW), null);
  assert.equal(normalizePremeeting(row({ start_dt: 'tomorrow' }), WINDOW), null);
  assert.equal(normalizePremeeting(row({ start_dt: '2026-10-19T14:59:00.000Z' }), WINDOW), null, 'yesterday in KST');
  assert.equal(normalizePremeeting(row({ start_dt: '2026-10-19T15:00:00.000Z' }), WINDOW).meetingDay, '2026-10-20', 'midnight KST is today');
  assert.equal(normalizePremeeting(row({ end_dt: '2026-10-21T04:00:00.000Z' }), WINDOW).meetingEndAt, null);
  assert.deepEqual(clientFacts(null), {});
  const { rows, skipped } = normalizePremeetings([
    row({ ms_no: 3, start_dt: '2026-10-25T01:00:00.000Z' }), row({ ms_no: 2 }), row({ ms_no: 2, client_rep_name: '나중 값' }),
    row({ ms_no: 4, mr_type: 3 }), row({ ms_no: 'bad' }), null,
  ], WINDOW);
  assert.deepEqual(rows.map((r) => [r.scheduleNo, r.company]), [['2', '나중 값'], ['3', '가상상사']]);
  assert.equal(skipped, 1);
});

test('API items, links and sync status carry only display fields', () => {
  const stored = { schedule_no: '9001', meeting_at: '2026-10-21T05:00:00+00:00', meeting_end_at: null, meeting_day: '2026-10-21', meeting_way: 'zoom',
    company: '가상상사', contact: '홍길동', sales_owner: '박영업', managers: ['박영업'], booked_by: '김티엠', crm_project_no: '77', visited: false, client: { members: '1인 기업' }, note: '' };
  assert.deepEqual(premeetingItem(stored), { scheduleNo: '9001', meetingAt: '2026-10-21T05:00:00+00:00', meetingEndAt: null, meetingDay: '2026-10-21', way: 'zoom',
    company: '가상상사', contact: '홍길동', salesOwner: '박영업', managers: ['박영업'], bookedBy: '김티엠', projectNo: '77', visited: false, client: { members: '1인 기업' }, note: '' });
  assert.deepEqual(premeetingItem(stored, { mine: true, projectId: 'p1' }).linked, { mine: true, projectId: 'p1' });
  assert.deepEqual(premeetingSync([{ status: 'FAILED', error_code: 'crm_http_401' }, { status: 'COMPLETED', completed_at: 'T1', window_start: 'a', window_end: 'b' }]),
    { at: 'T1', start: 'a', end: 'b', failed: 'crm_http_401' });
  assert.deepEqual(premeetingSync([]), { at: null, start: null, end: null, failed: null });
  assert.deepEqual(cleanSummary({ name: 'x', crm: { ms: '9001', proj: '77' }, evil: 1 }), { name: 'x', crm: { ms: '9001', proj: '77' } });
});

test('the fetcher is internal-schedule only, refuses truncated reads and returns counts only', () => {
  assert.match(config, /\[functions\.kpi-buildup-premeetings\]\s*\nverify_jwt = true/);
  const auth = fetcher.indexOf('safeEqual(req.headers.get("x-kpi-cron-secret")');
  assert.ok(auth > 0 && auth < fetcher.indexOf('createClient(') && auth < fetcher.indexOf('fetch(CRM_SCHEDULES'), 'cron secret checked before any work');
  assert.match(fetcher, /Deno\.env\.get\("KPI_MARKETING_CRON_SECRET"\)/);
  assert.match(fetcher, /Deno\.env\.get\("CRM_BEARER_TOKEN"\)/);
  assert.doesNotMatch(fetcher, /body\.crmToken|console\.(log|info|debug)/);
  assert.match(fetcher, /list\.length >= CRM_PAGE_LIMIT\) return await fail\("crm_page_limit"/);
  assert.match(fetcher, /rpc\("buildup_store_premeetings"/);
  assert.match(fetcher, /from\("buildup_premeetings"\)\.delete\(\{ count: "exact" \}\)\s*\.eq\("organization_id", organizationId\)\.lt\("meeting_day", cutoff\)/, 'retention purge is scoped to the organization and past rows');
  const returns = [...fetcher.matchAll(/return json\(\{([^}]*)\}/g)].map((m) => m[1]).join(' ');
  assert.doesNotMatch(returns, /\b(rows|items|list|company)\s*[:,}]|normalized\.rows(?!\.length)|\blist\b(?!\.length)/, 'responses never echo schedules');
  assert.match(returns, /fetched: normalized\.rows\.length/);
});

test('storage is server-only, refreshed at 08:00 KST and keeps no contact channels', () => {
  for (const table of ['buildup_premeetings', 'buildup_premeeting_runs']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security;`));
  }
  assert.match(migration, /revoke all on public\.buildup_premeetings, public\.buildup_premeeting_runs from anon, authenticated;/);
  assert.doesNotMatch(migration, /grant [^;]*(anon|authenticated)/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /returns jsonb language plpgsql security invoker set search_path = ''/);
  assert.match(migration, /revoke all on function public\.buildup_store_premeetings\(uuid, date, date, jsonb\) from public, anon, authenticated;/);
  assert.match(migration, /'pocket-buildup-premeetings',\s*'0 23 \* \* \*'/);
  assert.match(migration, /kpi_marketing_cron_secret/);
  const table = migration.slice(migration.indexOf('create table if not exists public.buildup_premeetings'), migration.indexOf('create index if not exists buildup_premeetings_upcoming'));
  assert.doesNotMatch(table, /phone|email|addr/i);
});

test('employees read upcoming premeetings through the authorized buildup API and bridge only', () => {
  const action = api.indexOf('action === "premeetings"');
  assert.ok(api.indexOf('authorizeEmployee(') < action && api.indexOf('canUseBuildup(access)') < action && api.indexOf('passwordChangeRequired(authUser)') < action);
  assert.match(api, /\.is\("removed_at", null\)\.gte\("meeting_day", today\)/);
  assert.match(api, /admin \? \{ ownerId: project\.owner_user_id, projectId: project\.project_id, ownerName:/, 'owner names only for OWNER/ADMIN');
  assert.equal(validateBridgeMessage({ id: 'r1', op: 'premeetings' }).op, 'premeetings');
  assert.equal(validateBridgeMessage({ id: 'r2', op: 'premeetings', args: { scope: 'all' } }), null);
});

test('the bridge forwards premeetings to the server call and returns only its result', async () => {
  const sent = [], calls = [];
  const bridge = createBuildupBridge({ post: (message) => sent.push(message), call: async (op, args) => { calls.push(op); return { ok: true, items: [{ scheduleNo: '1' }], today: '2026-10-20' }; },
    aiStream: async () => ({}), recorder: {}, prefs: { get: () => ({}), set: () => {} } });
  assert.equal(bridge.handle({ id: 'r1', op: 'premeetings' }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['premeetings']);
  assert.deepEqual(sent[0], { id: 'r1', ok: true, data: { items: [{ scheduleNo: '1' }], today: '2026-10-20' } });
});
