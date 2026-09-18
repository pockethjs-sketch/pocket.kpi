import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeEmployee, canEmployeeAct } from '../supabase/functions/_shared/employee-access.mjs';

const user = { id: 'test-user', role: 'authenticated', email_confirmed_at: '2026-09-18', is_anonymous: false };
const member = { organization_id: 'test-org', user_id: 'test-user', role: 'EDITOR', state: 'ACTIVE', archived_at: null };
const fixture = (options = {}) => ({
  request: new Request('https://example.invalid', { headers: { authorization: 'Bearer test-session' } }),
  organizationId: 'test-org',
  verifyUser: async () => ({ data: { user }, error: null }),
  findMembership: async () => ({ data: member, error: null }),
  ...options,
});

test('public app token alone never substitutes for an employee session', async () => {
  const result = await authorizeEmployee(fixture({
    request: new Request('https://example.invalid', { headers: { 'x-kpi-app-token': 'test-public-token' } }),
    verifyUser: () => { throw new Error('must not be called'); },
  }));
  assert.equal(result.status, 401);
});
test('invalid or expired session never reaches membership lookup', async () => {
  const result = await authorizeEmployee(fixture({ verifyUser: async () => ({ error: { message: 'expired' } }),
    findMembership: () => { assert.fail('must not be called'); } }));
  assert.equal(result.status, 401);
});
test('anonymous, service, and unconfirmed users are rejected', async () => {
  for (const change of [{ is_anonymous: true }, { role: 'service_role' }, { email_confirmed_at: null }]) {
    const result = await authorizeEmployee(fixture({ verifyUser: async () => ({ data: { user: { ...user, ...change } } }) }));
    assert.equal(result.status, 401);
  }
});
test('membership must match the server organization and verified user', async () => {
  for (const change of [{ organization_id: 'other-org' }, { user_id: 'other-user' }, { state: 'ARCHIVED' }, { archived_at: '2026-09-18' }, { role: 'SERVICE' }]) {
    const result = await authorizeEmployee(fixture({ findMembership: async () => ({ data: { ...member, ...change } }) }));
    assert.equal(result.status, 403);
  }
});
test('self-written metadata cannot grant approval', async () => {
  const result = await authorizeEmployee(fixture({
    verifyUser: async () => ({ data: { user: { ...user, user_metadata: { role: 'OWNER', approved: true } } } }),
    findMembership: async () => ({ data: null }),
  }));
  assert.equal(result.status, 403);
});
test('revocation takes effect on the next request, without JWT role caching', async () => {
  let active = true;
  const options = fixture({ findMembership: async () => ({ data: active ? member : null }) });
  assert.equal((await authorizeEmployee(options)).ok, true);
  active = false;
  assert.equal((await authorizeEmployee(options)).status, 403);
});
test('verification outages fail closed and do not expose error contents', async () => {
  for (const key of ['verifyUser', 'findMembership']) {
    const result = await authorizeEmployee(fixture({ [key]: async () => { throw new Error('private diagnostic'); } }));
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result).includes('private diagnostic'));
  }
});
test('read, write, and administration are independent server permissions', () => {
  assert.equal(canEmployeeAct({ ok: true, role: 'VIEWER' }, 'read'), true);
  assert.equal(canEmployeeAct({ ok: true, role: 'VIEWER' }, 'write'), false);
  assert.equal(canEmployeeAct({ ok: true, role: 'EDITOR' }, 'write'), true);
  assert.equal(canEmployeeAct({ ok: true, role: 'EDITOR' }, 'admin'), false);
  assert.equal(canEmployeeAct({ ok: true, role: 'ADMIN' }, 'admin'), true);
  assert.equal(canEmployeeAct({ ok: true, role: 'OWNER' }, 'unknown'), false);
  assert.equal(canEmployeeAct({ ok: false, role: 'OWNER' }, 'read'), false);
});
