import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync(new URL('../supabase/functions/kpi-master-auth/index.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/EmployeeEntry.jsx', import.meta.url), 'utf8');
const session = readFileSync(new URL('../src/employeeSession.js', import.meta.url), 'utf8');

test('MASTER bootstrap is server-only, one-time, confirmed and creates OWNER membership', () => {
  assert.match(edge, /KPI_MASTER_BOOTSTRAP_TOKEN/);
  assert.match(edge, /auth\.admin\.createUser/);
  assert.match(edge, /email_confirm:\s*true/);
  assert.match(edge, /organization_memberships/);
  assert.match(edge, /role:\s*"OWNER"/);
  assert.match(edge, /auth\.admin\.deleteUser/);
  assert.doesNotMatch(edge, /pocket\.hjs@gmail\.com/);
});

test('MASTER login uses Supabase password sessions without browser password hashes or email', () => {
  assert.match(edge, /signInWithPassword/);
  assert.match(session, /employeeAuth\.auth\.setSession/);
  assert.match(entry, /masterAliasRequest/);
  assert.doesNotMatch(entry, /MASTER 연결 이메일/);
  assert.doesNotMatch(entry, /MASTER_EMAIL_STORAGE_KEY/);
});

test('MASTER endpoint has explicit unauthenticated boundary and generic credential failures', () => {
  assert.match(edge, /invalid_credentials/);
  assert.match(edge, /setTimeout\(resolve, 400\)/);
  assert.match(edge, /cache-control": "no-store/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,80}return/);
});
