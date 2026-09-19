import test from 'node:test';
import assert from 'node:assert/strict';
import { isMasterLoginAlias, isPlausibleEmail, resolveEmployeeLoginEmail } from '../src/data/masterLoginAlias.js';

test('MASTER is accepted case-insensitively without publishing an administrator email', () => {
  assert.equal(isMasterLoginAlias('MASTER'), true);
  assert.equal(isMasterLoginAlias(' master '), true);
  assert.equal(resolveEmployeeLoginEmail('MASTER', ' Admin@Example.com '), 'admin@example.com');
});

test('ordinary employees continue to use their own email', () => {
  assert.equal(isMasterLoginAlias('employee@example.com'), false);
  assert.equal(resolveEmployeeLoginEmail(' Employee@Example.com ', 'admin@example.com'), 'employee@example.com');
});

test('invalid aliases cannot reach Supabase password authentication', () => {
  assert.equal(resolveEmployeeLoginEmail('MASTER', ''), '');
  assert.equal(isPlausibleEmail(''), false);
  assert.equal(isPlausibleEmail('MASTER'), false);
  assert.equal(isPlausibleEmail('employee@example.com'), true);
});
