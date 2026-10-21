import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_ROLES, PASSWORD_FLAG, isAccountAdmin, passwordChangeRequired, isMasterUser, canAssignRole, canManageTarget,
  normalizeEmail, validateTempPassword, validateNewPassword, displayName, validateCreate, validateUpdate, accountRow, sortAccounts, authErrorCode,
} from '../supabase/functions/_shared/account-access.mjs';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const access = (role, extra = {}) => ({ ok: true, userId: ME, organizationId: 'test-org', role, scope: 'all', ...extra });
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const edge = read('../supabase/functions/kpi-account-api/index.ts');
const buildupEdge = read('../supabase/functions/kpi-buildup-api/index.ts');
const config = read('../supabase/config.toml');
const entry = read('../src/EmployeeEntry.jsx');
const setup = read('../src/PasswordSetup.jsx');
const api = read('../src/data/accountApi.js');
const screen = read('../src/AccountWorkspace.jsx');

test('only MASTER/OWNER and ADMIN manage accounts; ADMIN role is granted by OWNER only', () => {
  assert.deepEqual(ACCOUNT_ROLES, ['ADMIN', 'EDITOR', 'VIEWER']);
  assert.equal(isAccountAdmin(access('OWNER')), true);
  assert.equal(isAccountAdmin(access('ADMIN')), true);
  assert.equal(isAccountAdmin(access('EDITOR')), false);
  assert.equal(isAccountAdmin(access('ADMIN', { scope: 'premeeting' })), false);
  assert.equal(isAccountAdmin({ ok: false }), false);
  assert.equal(canAssignRole(access('OWNER'), 'ADMIN'), true);
  assert.equal(canAssignRole(access('ADMIN'), 'ADMIN'), false);
  assert.equal(canAssignRole(access('ADMIN'), 'EDITOR'), true);
  assert.equal(canAssignRole(access('OWNER'), 'OWNER'), false);
});

test('MASTER, OWNER, SERVICE and one\'s own account are never managed from the screen', () => {
  const target = (role, extra = {}) => ({ userId: OTHER, role, master: false, ...extra });
  assert.equal(canManageTarget(access('OWNER'), target('EDITOR')), true);
  assert.equal(canManageTarget(access('OWNER'), target('ADMIN')), true);
  assert.equal(canManageTarget(access('ADMIN'), target('ADMIN')), false);
  assert.equal(canManageTarget(access('ADMIN'), target('VIEWER')), true);
  assert.equal(canManageTarget(access('OWNER'), target('OWNER')), false);
  assert.equal(canManageTarget(access('OWNER'), target('EDITOR', { master: true })), false);
  assert.equal(canManageTarget(access('OWNER'), target('SERVICE')), false);
  assert.equal(canManageTarget(access('OWNER'), { userId: ME, role: 'EDITOR' }), false);
  assert.equal(canManageTarget(access('EDITOR'), target('VIEWER')), false);
  assert.equal(canManageTarget(access('OWNER'), { userId: 'not-a-uuid', role: 'EDITOR' }), false);
});

test('temporary and personal passwords are validated without being echoed', () => {
  assert.equal(validateTempPassword('abcd1234wxyz').ok, true);
  // Supabase Auth on this project requires 12+ characters, so shorter temporary passwords are refused before the Auth call.
  for (const short of ['abcd1234', 'abcd1234wxy']) assert.equal(validateTempPassword(short).error, 'invalid_temp_password');
  for (const bad of ['short1', ' padded12', 'padded12 ', 'line\nbreak1', 'x'.repeat(73), undefined]) assert.equal(validateTempPassword(bad).ok, false);
  assert.equal(validateNewPassword('my-own-password').ok, true);
  for (const bad of ['eleven-char', 'aaaaaaaaaaaaaa', '            ', 'tab\there-long-pw']) assert.equal(validateNewPassword(bad).error, 'weak_password');
  assert.doesNotMatch(JSON.stringify(validateTempPassword('short1')), /short1/);
});

test('account creation and updates are validated against the caller', () => {
  assert.equal(normalizeEmail('  Design@Pocket.Company '), 'design@pocket.company');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(displayName('design@pocket.company', ''), 'design');
  assert.equal(displayName('x@y.z', '  디자인팀  '), '디자인팀');
  const created = validateCreate(access('OWNER'), { email: 'CEO@pocket.company', role: 'EDITOR', password: 'temporary123' });
  assert.deepEqual(created.value, { email: 'ceo@pocket.company', role: 'EDITOR', password: 'temporary123', name: 'ceo' });
  assert.equal(validateCreate(access('ADMIN'), { email: 'a@b.co', role: 'ADMIN', password: 'temporary123' }).error, 'role_not_allowed');
  assert.equal(validateCreate(access('OWNER'), { email: 'a@b.co', role: 'OWNER', password: 'temporary123' }).error, 'role_not_allowed');
  assert.equal(validateCreate(access('OWNER'), { email: 'bad', password: 'temporary123' }).error, 'invalid_email');
  const target = { userId: OTHER, role: 'EDITOR', master: false };
  assert.deepEqual(validateUpdate(access('OWNER'), target, { role: 'VIEWER', active: false, name: ' 디자인 ' }).value, { role: 'VIEWER', active: false, name: '디자인' });
  assert.equal(validateUpdate(access('OWNER'), target, {}).error, 'invalid_account_update');
  assert.equal(validateUpdate(access('OWNER'), target, { active: 'no' }).error, 'invalid_account_update');
  assert.equal(validateUpdate(access('OWNER'), { ...target, master: true }, { active: false }).error, 'account_protected');
});

test('list rows hide the MASTER alias address and show first-login password state', () => {
  const membership = { user_id: OTHER, role: 'EDITOR', state: 'ACTIVE', archived_at: null, created_at: '2026-10-20T00:00:00Z' };
  const user = { email: 'design@pocket.company', last_sign_in_at: null, app_metadata: { [PASSWORD_FLAG]: true } };
  const row = accountRow({ membership, profile: { display_name: 'design' }, user, me: ME });
  assert.deepEqual(row, { userId: OTHER, email: 'design@pocket.company', name: 'design', role: 'EDITOR', active: true, master: false, self: false, mustChangePassword: true, lastSignInAt: null, createdAt: '2026-10-20T00:00:00Z' });
  const master = accountRow({ membership: { ...membership, user_id: ME, role: 'OWNER' }, profile: { display_name: 'MASTER' }, user: { email: 'master@auth.pocket-kpi.invalid', app_metadata: { kpi_master_alias: true } }, me: ME });
  assert.equal(master.email, 'MASTER');
  assert.equal(master.self, true);
  assert.equal(isMasterUser({ app_metadata: { kpi_master_alias: true } }), true);
  assert.equal(passwordChangeRequired({ app_metadata: {} }), false);
  assert.equal(accountRow({ membership: { ...membership, state: 'ARCHIVED' }, user, me: ME }).active, false);
  assert.deepEqual(sortAccounts([{ role: 'VIEWER', active: true, email: 'b' }, { role: 'OWNER', active: true, email: 'MASTER' }, { role: 'EDITOR', active: false, email: 'a' }]).map((r) => r.role), ['OWNER', 'EDITOR', 'VIEWER']);
  assert.equal(authErrorCode({ message: 'A user with this email address has already been registered' }), 'account_exists');
  assert.equal(authErrorCode({ code: 'weak_password' }), 'weak_password');
});

test('account function authenticates every action and never returns passwords', () => {
  assert.match(config, /\[functions\.kpi-account-api\]\s*\nverify_jwt = true/);
  assert.doesNotMatch(edge, /bootstrap|x-bootstrap-token/i, 'no unauthenticated account-creation path');
  assert.ok(edge.indexOf('authorizeEmployee(') < edge.indexOf('action === "status"'), 'every action runs after employee authorization');
  assert.match(edge, /if \(mustChange\) return reply\(req, \{ error: "password_change_required" \}, 403\)/);
  assert.ok(edge.indexOf('if (mustChange)') < edge.indexOf('action === "accounts"'), 'temporary-password sessions cannot manage accounts');
  assert.match(edge, /email_confirm: true/);
  assert.match(edge, /\[PASSWORD_FLAG\]: true/);
  assert.match(edge, /\[PASSWORD_FLAG\]: null/);
  assert.doesNotMatch(edge, /reply\([^;]*(checked\.value|temp\.value|input\.password|body\.password)/, 'no reply contains a password value');
  assert.doesNotMatch(edge, /audit\([^;]*(checked\.value|temp\.value|input\.password|body\.password|password:)/, 'audit rows never hold a password');
  assert.doesNotMatch(edge, /console\.(log|info|debug)/);
  assert.match(buildupEdge, /passwordChangeRequired\(authUser\)\) return reply\(req, \{ error: "password_change_required" \}, 403\)/);
});

test('login entry asks for a new password before any workspace loads', () => {
  const session = entry.indexOf("await employeeRequest('session')"), status = entry.indexOf("accountRequest('status')");
  assert.ok(session > 0 && session < status && status < entry.indexOf('loadingApp = true') && entry.indexOf('loadingApp = true') < entry.indexOf("await import('./main.jsx')"));
  assert.match(entry, /if \(account\?\.mustChangePassword\) \{ passwordPending = true; setLoadedApp\(null\); setPasswordGate\(account\)/);
  assert.match(entry, /if \(passwordGate\) return <PasswordSetup/);
  assert.match(setup, /accountRequest\('change_password', \{ password \}\)/);
  assert.match(setup, /autoComplete="new-password"/);
  for (const source of [setup, api, screen]) assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(log|info|debug)/);
  assert.match(api, /functions\/v1\/kpi-account-api/);
});

test('no temporary password value is committed to source', () => {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(js|jsx|mjs|ts|sql|toml)$/.test(name)) files.push(path); } };
  walk(new URL('../src', import.meta.url).pathname);
  walk(new URL('../supabase', import.meta.url).pathname);
  for (const path of files) assert.doesNotMatch(readFileSync(path, 'utf8'), /12345678-/, path);
});
