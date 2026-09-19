import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFromEmployeeAccess } from '../src/data/employeeAccount.js';

test('owner and admin are presented as the legacy MASTER account', () => {
  for (const serverRole of ['OWNER', 'ADMIN', 'admin']) {
    const account = accountFromEmployeeAccess({ userId: 'employee-1', role: serverRole }, ['home', 'settings']);
    assert.equal(account.username, 'MASTER');
    assert.equal(account.displayName, 'MASTER');
    assert.equal(account.role, 'MASTER');
    assert.equal(account.serverRole, serverRole.toUpperCase());
    assert.deepEqual(account.allowedPages, []);
  }
});

test('editor and viewer keep USER presentation and ordinary page access', () => {
  for (const serverRole of ['EDITOR', 'VIEWER']) {
    const account = accountFromEmployeeAccess({ userId: 'employee-2', role: serverRole }, ['home', 'home', 'contracts']);
    assert.equal(account.username, 'USER');
    assert.equal(account.displayName, 'USER');
    assert.equal(account.role, 'USER');
    assert.deepEqual(account.allowedPages, ['home', 'contracts']);
  }
});

test('an unverified employee cannot become MASTER', () => {
  assert.equal(accountFromEmployeeAccess(null, ['home']), null);
  assert.equal(accountFromEmployeeAccess({ role: 'OWNER' }, ['home']), null);
  assert.equal(accountFromEmployeeAccess({ userId: 'employee-3', role: 'UNKNOWN' }, ['home']).role, 'USER');
});
