import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyEmployeeMenuPolicy, EMPLOYEE_MENU_PROFILES } from '../src/data/employeeMenuPolicy.js';
import { accountFromEmployeeAccess } from '../src/data/employeeAccount.js';

const employee = { userId: 'synthetic-viewer', organizationId: 'synthetic-org', role: 'VIEWER' };
const fingerprint = createHash('sha256').update(`${employee.organizationId}:${employee.userId}`).digest('hex');
const profiles = { [fingerprint]: ['deals', 'ltvExpansion'] };
const pages = ['performanceCheck', 'deals', 'ltvExpansion', 'products', 'settings', 'marketingMeta'];

test('target viewer has exactly two menus, with premeeting first', async () => {
  const access = await applyEmployeeMenuPolicy(employee, profiles);
  assert.deepEqual(accountFromEmployeeAccess(access, pages).allowedPages, ['deals', 'ltvExpansion']);
  assert.equal(access.role, 'VIEWER');
  assert.equal(access.scope, undefined); // Must not claim a server data scope.
  assert.equal(employee.menuPages, undefined);
});
test('other users, organizations and MASTER remain unchanged', async () => {
  for (const change of [{userId:'another'}, {organizationId:'another'}, {role:'OWNER'}, {role:'ADMIN'}, {role:'EDITOR'}]) {
    const access = {...employee, ...change};
    assert.equal(await applyEmployeeMenuPolicy(access, profiles), access);
  }
});
test('missing identity never acquires a menu profile', async () => {
  for (const access of [null, {}, {role:'VIEWER',userId:'synthetic-viewer'}]) assert.equal(await applyEmployeeMenuPolicy(access, profiles), access);
});
test('deployed preference has only the two requested pages and no raw identity', () => {
  assert.equal(Object.keys(EMPLOYEE_MENU_PROFILES).length, 1);
  for (const [key, value] of Object.entries(EMPLOYEE_MENU_PROFILES)) {
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.deepEqual(value, ['deals','ltvExpansion']);
  }
});
test('page preference cannot expand a server premeeting scope or MASTER role', () => {
  assert.deepEqual(accountFromEmployeeAccess({...employee,scope:'premeeting',menuPages:pages},pages).allowedPages,['deals']);
  assert.deepEqual(accountFromEmployeeAccess({...employee,role:'ADMIN',menuPages:['deals']},pages).allowedPages,[]);
});
