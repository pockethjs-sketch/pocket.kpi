import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac } from 'node:crypto';
import { authorizeEmployee, canEmployeeAct, mutationPermission } from '../supabase/functions/_shared/employee-access.mjs';
import * as scopeAccess from '../supabase/functions/_shared/premeeting-access.mjs';
import * as receivablesAccess from '../supabase/functions/_shared/receivables-access.mjs';
const domain = readFileSync(new URL('../supabase/functions/kpi-domain-api/index.ts', import.meta.url), 'utf8');
const gs = readFileSync(new URL('../../pocket-kpi-deploy/Code.gs', import.meta.url), 'utf8');
function handler(role, user = true, scope = 'all', grant = null, current = null) {
  let callback, writes = 0;
  const member = { organization_id: 'org', user_id: 'user', role, state: 'ACTIVE', archived_at: null, access_scope: scope };
  const client = {
    auth: { getUser: async () => user ? { data: { user: { id: 'user', role: 'authenticated', email_confirmed_at: '2026-09-18' } } } : { error: {} } },
    rpc: async (name) => { if (name !== 'kpi_claim_employee_invitation') writes++; return { data: { ok: true } }; },
    from: (table) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'organization_memberships' ? member : table === 'employee_write_grants' ? grant : current }) };
      assert.ok(['organization_memberships','employee_write_grants','app_current_state'].includes(table)); return query;
    },
  };
  const source = stripTypeScriptTypes(domain.replace(/^import .*;\r?\n/gm, ''), { mode: 'transform' });
  vm.runInNewContext(source, { createClient: () => client, authorizeEmployee, canEmployeeAct, mutationPermission, ...scopeAccess, ...receivablesAccess,
    URL, Request, Response, TextEncoder, AbortSignal, crypto: globalThis.crypto,
    Deno: { env: { get: (key) => key === 'KPI_ORGANIZATION_ID' ? 'org' : 'test-only' }, serve: (fn) => { callback = fn; } } });
  return { call: (action, body = {}) => callback(new Request('https://example.invalid', { method: 'POST', headers: { authorization: 'Bearer synthetic-session', 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) })), writes: () => writes };
}
test('real handler denies invalid sessions before data read/write', async () => {
  const h = handler('ADMIN', false);
  for (const action of ['crm', 'mutation', 'sheet_bridge', 'employees']) assert.equal((await h.call(action)).status, 401);
  assert.equal(h.writes(), 0);
});
test('limited employee cannot request other business pages or privileged actions', async () => {
  const h = handler('EDITOR', true, 'premeeting');
  assert.equal((await (await h.call('session')).json()).scope, 'premeeting');
  for (const action of ['marketing','contract_history','support_board','notion_receivables','crm_refresh','employees']) assert.equal((await h.call(action)).status, 403);
  assert.equal((await h.call('sheet_bridge', { sheetAction: 'marketing_status' })).status, 403);
  assert.equal(h.writes(), 0);
});
test('real handler denies viewer writes and editor administration', async () => {
  const viewer = handler('VIEWER');
  for (const action of ['mutation', 'crm_refresh', 'employees']) assert.equal((await viewer.call(action)).status, 403);
  assert.equal((await viewer.call('sheet_bridge', { sheetAction: 'contract_auto_sync' })).status, 403);
  const editor = handler('EDITOR');
  assert.equal((await editor.call('mutation', { mutation: { documents: { settings: {} } } })).status, 403);
  assert.equal((await editor.call('employees')).status, 403);
  assert.equal(viewer.writes() + editor.writes(), 0);
});
test('authorized session and normal patch commit preserve contract', async () => {
  const h = handler('EDITOR');
  assert.equal((await h.call('session')).status, 200);
  const response = await h.call('mutation', { mutationId: 'test', baseRevision: 'a', nextRevision: 'b', mutation: { collections: { leads: { patches: [] } } } });
  assert.equal(response.status, 200); assert.equal((await response.json()).primary, 'supabase'); assert.equal(h.writes(), 1);
});

test('supplemental VIEWER grant allows only current eligible record patches', async () => {
  const grant = { profile: 'premeeting_receivables', enabled: true };
  const current = { primary_revision: 'a', state_snapshot: { leads: [{ id: 'l1', status: '계약 완료' }] } };
  const h = handler('VIEWER', true, 'all', grant, current);
  const session = await (await h.call('session')).json();
  assert.equal(session.role, 'VIEWER');
  assert.deepEqual(session.writePages, ['deals','ltvExpansion']);
  assert.equal(session.scope, undefined); // Do not expose the undeployed invitation scope.
  const mutation = { schemaVersion: 3, origin: 'user', collections: { leads: { idField: 'id', upsert: [], remove: [], patches: [{ id: 'l1', ops: [{ op: 'set', path: ['vendorNote'], value: 'synthetic edit' }] }] } } };
  const body = { mutationId: 'synthetic', baseRevision: 'a', nextRevision: 'b', mutation };
  assert.equal((await h.call('mutation', body)).status, 200);
  assert.equal(h.writes(), 1);
  for (const action of ['employees','crm_refresh']) assert.equal((await h.call(action)).status, 403);
  assert.equal((await h.call('sheet_bridge', { sheetAction: 'contract_auto_sync' })).status, 403);
  assert.equal((await h.call('mutation', { ...body, baseRevision: 'stale' })).status, 409);
  assert.equal((await h.call('mutation', { ...body, mutation: { ...mutation, documents: { settings: {} } } })).status, 403);
  assert.equal(h.writes(), 1);
  for (const g of [null, { ...grant, enabled: false }, { ...grant, profile: 'unknown' }]) {
    const revoked = handler('VIEWER', true, 'all', g, current);
    assert.equal((await revoked.call('mutation', body)).status, 403); assert.equal(revoked.writes(), 0);
  }
});
test('Apps Script rejects public tokens; HMAC validates exact content and timestamp', () => {
  const secret = 'synthetic-private-server-secret';
  const scope = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) }, Utilities: { Charset: { UTF_8: 'utf-8' }, computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()] } };
  vm.runInNewContext(gs, scope); scope._json = (value) => value;
  assert.equal(scope.doGet({ parameter: { token: 'old-public-token' } }).error, 'employee_gateway_required');
  assert.equal(scope.doPost({ postData: { contents: JSON.stringify({ token: 'old-public-token', action: 'save_v2' }) } }).error, 'employee_gateway_required');
  const timestamp = String(Date.now()), payload = JSON.stringify({ action: 'daily_sync_status' });
  const signature = createHmac('sha256', secret).update(`kpi-sheet-v1.${timestamp}.${payload}`).digest('hex');
  assert.equal(scope._crmVerifyEmployeeGateway_({ timestamp, payload, signature }).action, 'daily_sync_status');
  assert.equal(scope._crmVerifyEmployeeGateway_({ timestamp: '0', payload, signature }), null);
  assert.equal(scope._crmVerifyEmployeeGateway_({ timestamp, payload: payload + ' ', signature }), null);
  assert.equal(scope._crmVerifyEmployeeGateway_({ timestamp, payload, signature: signature.slice(1) }), null);
});
test('entry defers CRM until authorization and isolates employee cache', () => {
  const entry = readFileSync(new URL('../src/EmployeeEntry.jsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("await employeeRequest('session')") < entry.indexOf("await import('./main.jsx')"));
  assert.match(main, /const localStorage = window.kpiEmployeeStorage/);
  assert.doesNotMatch(main, /pocket-crm-9f3k7x/);
  assert.doesNotMatch(main, /createRoot\(/);
});
