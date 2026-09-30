import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFromEmployeeAccess } from '../src/data/employeeAccount.js';
import { readFileSync } from 'node:fs';

test('restored templates are available to ordinary accounts but not the two-menu viewer', () => {
  const pages = ['deals', 'ltvExpansion', 'templates', 'org'];
  for (const role of ['EDITOR', 'VIEWER']) {
    assert.deepEqual(accountFromEmployeeAccess({userId:'synthetic',role}, pages).allowedPages, ['deals','ltvExpansion','templates']);
  }
  assert.deepEqual(accountFromEmployeeAccess({userId:'synthetic',role:'VIEWER',menuPages:['deals','ltvExpansion']}, pages).allowedPages, ['deals','ltvExpansion']);
  assert.deepEqual(accountFromEmployeeAccess({userId:'synthetic',role:'EDITOR',scope:'premeeting'}, pages).allowedPages, ['deals']);
});

test('template navigation and existing data bindings are restored without seeding data', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const navigation = source.slice(source.indexOf('const NAV_SECTIONS ='), source.indexOf('const NAV ='));
  assert.match(navigation, /id: "templates", label: "메시지 · 스크립트"/);
  const access = source.match(/const canAccess =[^\n]+/)[0];
  assert.ok(!access.includes('templates'));
  assert.ok(access.includes("pageId !== 'org'"));
  const component = source.slice(source.indexOf('function TemplatesView()'), source.indexOf('function MarketingView()'));
  assert.ok(component.includes('db.templates?.pre?.[b]?.confirm'));
  assert.equal((component.match(/readOnly=\{readOnly\}/g)||[]).length, 1);
  assert.ok(component.includes('<CopyBtn text={confirmation} />'));
  for (const removed of ['TM 스크립트','미팅 전 시퀀스','미팅 후 재영업','PRE_STEPS.map','POST_STEPS.map']) assert.ok(!component.includes(removed));
  assert.ok(!component.includes('seedTemplates'));
});

test('confirmation edit preserves unrelated saved templates and other buildups', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const component = source.slice(source.indexOf('function TemplatesView()'), source.indexOf('function MarketingView()'));
  const body = component.match(/onChange=\{\(e\) => up\(\(d\) => \{([\s\S]*?)\}\)\}/)[1];
  const update = new Function('d','b','e',body);
  const original = {templates:{tm:{A:'keep'},pre:{A:{confirm:'old',d3:'keep',d1:'keep'},B:{confirm:'other'}},post:{A:{f0:'keep'}}}};
  const expected = structuredClone(original); expected.templates.pre.A.confirm='new';
  update(original,'A',{target:{value:'new'}});
  assert.deepEqual(original,expected);
  const empty={}; update(empty,'A',{target:{value:'new'}});
  assert.deepEqual(empty,{templates:{pre:{A:{confirm:'new'}}}});
});

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
