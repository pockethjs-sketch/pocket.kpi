import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { WORKSPACES, MARKETING_HUB, INITIAL_WORKSPACE, ACCOUNT_WORKSPACE, canManageAccounts, selectWorkspace, BUILDUP_SANDBOX, BUILDUP_CSP, BUILDUP_FRAME_ALLOW, BUILDUP_NOTICE, prepareBuildupDocument } from '../src/data/workspaces.js';
import { BUILDUP_AI_MODELS } from '../supabase/functions/_shared/buildup-access.mjs';

// SHA-256 of the v4.9 web build copied from the intelligence project (see docs/WORKSPACES.md).
const BUILDUP_ASSET_SHA256 = '7b596cfd42ca59c2f265d9b597ac0f042887648ccd8766f9b832cfb1e415f66c';
const shellSource = readFileSync(new URL('../src/WorkspaceShell.jsx', import.meta.url), 'utf8');
const frameSource = readFileSync(new URL('../src/BuildupWorkspace.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const source = shellSource.replace(/^import .*\r?\n/gm, '').replace('export default ', '');
const { code } = await transformWithOxc(source, 'WorkspaceShell.jsx', { jsx: { runtime: 'classic' } });
const icon = () => null;
function compile(useState, BuildupWorkspace = () => null, AccountWorkspace = () => null) {
  return new Function('React', 'useState', 'WORKSPACES', 'MARKETING_HUB', 'INITIAL_WORKSPACE', 'ACCOUNT_WORKSPACE', 'canManageAccounts', 'selectWorkspace', 'BuildupWorkspace', 'AccountWorkspace', 'ArrowRight', 'ChartNoAxesCombined', 'Layers3', 'LayoutGrid', 'Users', code + ';return WorkspaceShell;')(
    React, useState, WORKSPACES, MARKETING_HUB, INITIAL_WORKSPACE, ACCOUNT_WORKSPACE, canManageAccounts, selectWorkspace, BuildupWorkspace, AccountWorkspace, icon, icon, icon, icon, icon,
  );
}
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
}

test('only KPI and sales buildup workspaces are introduced, with a chooser as the initial screen', () => {
  assert.deepEqual(WORKSPACES.map(item => item.id), ['kpi', 'buildup']);
  const Component = compile(React.useState);
  let kpiRendered = false;
  const Kpi = () => { kpiRendered = true; return React.createElement('p', null, 'synthetic KPI'); };
  const html = renderToStaticMarkup(React.createElement(Component, null, React.createElement(Kpi)));
  assert.match(html, /업무 공간을 선택하세요/);
  assert.match(html, /KPI 시트 열기/);
  assert.match(html, /빌드업 화면 열기/);
  assert.equal(kpiRendered, false);
  assert.doesNotMatch(html, /<iframe/);
});

test('real navigation handlers keep both visited panels mounted across home/KPI/buildup transitions', () => {
  let state = INITIAL_WORKSPACE;
  const useState = () => [state, next => { state = next(state); }];
  const Component = compile(useState);
  const child = React.createElement('input', { defaultValue: 'synthetic unsaved draft' });
  const render = () => Component({ children: child, onSignOut: () => {} });
  const panel = (tree, kind) => elements(tree).find(node => node.props?.className === 'workspace-panel workspace-panel--' + kind);
  const click = (tree, label) => elements(tree).find(node => node.type === 'button' && node.props.children === label).props.onClick();
  let tree = render();
  click(tree, 'KPI 시트'); tree = render();
  assert.equal(panel(tree, 'kpi').props.hidden, false);
  assert.equal(panel(tree, 'kpi').props.children, child);
  click(tree, '빌드업 인텔리전스'); tree = render();
  const frameType = panel(tree, 'buildup').props.children.type;
  assert.equal(panel(tree, 'buildup').props.hidden, false);
  assert.equal(panel(tree, 'kpi').props.children, child);
  click(tree, '선택 홈'); tree = render();
  assert.equal(panel(tree, 'kpi').props.hidden, true);
  assert.equal(panel(tree, 'kpi').props.children, child);
  assert.equal(panel(tree, 'buildup').props.children.type, frameType);
  click(tree, 'KPI 시트'); tree = render();
  assert.equal(panel(tree, 'kpi').props.children, child);
  assert.equal(selectWorkspace(state, 'unknown'), state);
  assert.equal(INITIAL_WORKSPACE.kpiOpened, false);
});

test('chooser adds a marketing hub external card without changing internal navigation or passing state', () => {
  let state = INITIAL_WORKSPACE;
  const Component = compile(() => [state, next => { state = next(state); }]);
  const tree = Component({ children: React.createElement('input', { defaultValue: 'synthetic draft' }) });
  const links = elements(tree).filter(node => node.type === 'a');
  assert.equal(links.length, 1);
  const link = links[0];
  assert.equal(link.props.href, 'https://pocket-mkt.github.io/');
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noopener noreferrer');
  assert.equal(link.props.referrerPolicy, 'no-referrer');
  assert.match(link.props['aria-label'], /마케팅 허브.*새 탭/);
  assert.equal(link.props.onClick, undefined);
  assert.equal(state, INITIAL_WORKSPACE);
  assert.equal(selectWorkspace(state, 'marketing'), state);
  const nav = elements(tree).find(node => node.type === 'nav');
  assert.equal(elements(nav).filter(node => node.type === 'button').length, 3);
  const html = renderToStaticMarkup(React.createElement(compile(React.useState)));
  assert.equal((html.match(/class="workspace-card"/g) || []).length, 3);
  assert.match(html, /마케팅 허브 열기/);
});

test('workspace logout delegates to the existing employee signout without clearing journals', () => {
  const Component = compile(() => [INITIAL_WORKSPACE, () => {}]);
  let calls = 0;
  const tree = Component({ onSignOut: () => { calls++; } });
  elements(tree).find(node => node.type === 'button' && node.props.children === '로그아웃').props.onClick();
  assert.equal(calls, 1);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|fetch\(|employeeRequest|postMessage/);
  assert.doesNotMatch(frameSource, /localStorage|sessionStorage|fetch\(|employeeRequest|employeeHeaders/);
  assert.match(main, /<WorkspaceShell onSignOut=\{\(\) => window.kpiSignOut\(\)\}><KpiWorkspace \/><\/WorkspaceShell>/);
  const entry = readFileSync(new URL('../src/EmployeeEntry.jsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("await employeeRequest('session')") < entry.indexOf("await import('./main.jsx')"));
  assert.match(main, /if \(!window.kpiEmployeeAccess\?\.userId\) throw new Error\('employee_login_required'\)/);
});

test('v4.9 web build is pinned, syntactically valid, bridge-only and isolated from KPI credentials', () => {
  const raw = readFileSync(new URL('../src/assets/buildup-intelligence.html', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), BUILDUP_ASSET_SHA256);
  const html = raw.toString('utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  for (const [index, match] of scripts.entries()) new vm.Script(match[1], { filename: 'buildup-inline-' + index + '.js' });
  assert.match(scripts[0][1], /^\s*window\.PK_WEB = 1;/);
  // Workspace AI (insights, chat, recap, report) always asks the server for Claude Opus 5.5 with the company key.
  assert.match(scripts[0][1], /const WEB_MODEL = 'claude-opus-5-5';/);
  assert.match(scripts[0][1], /const body = \{ model: WEB_MODEL, max_tokens:/);
  assert.ok(BUILDUP_AI_MODELS.includes('claude-opus-5-5'));
  // Upcoming CRM premeetings reach the frame only through the bridge op (no network in the frame).
  assert.match(scripts[0][1], /web\.bridge\.call\('premeetings', \{\}/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=["']https?:/i);
  const prepared = prepareBuildupDocument(html);
  assert.ok(prepared.indexOf('Content-Security-Policy') < prepared.search(/<script\b/));
  assert.equal(prepared.replace(`<meta http-equiv="Content-Security-Policy" content="${BUILDUP_CSP}">`, ''), html);
  assert.doesNotMatch(BUILDUP_SANDBOX, /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.match(BUILDUP_CSP, /connect-src 'none'/);
  assert.match(BUILDUP_CSP, /script-src 'unsafe-inline';/);
  assert.match(BUILDUP_FRAME_ALLOW, /microphone 'none'/);
  assert.match(frameSource, /sandbox=\{BUILDUP_SANDBOX\}/);
  assert.match(frameSource, /allow=\{BUILDUP_FRAME_ALLOW\}/);
  assert.match(frameSource, /createBuildupRecorder/);
  assert.match(BUILDUP_NOTICE, /직원 계정별로 자동 저장/);
  assert.match(BUILDUP_NOTICE, /녹음 파일\(음성\)은 서버에 남지 않/);
  assert.match(frameSource, /\.catch\(/);
  assert.throws(() => prepareBuildupDocument('invalid'), /buildup_document_invalid/);
});

test('account management is offered only to MASTER/OWNER and ADMIN sessions', () => {
  assert.equal(canManageAccounts({ role: 'OWNER' }), true);
  assert.equal(canManageAccounts({ role: 'ADMIN' }), true);
  assert.equal(canManageAccounts({ role: 'EDITOR' }), false);
  assert.equal(canManageAccounts({ role: 'VIEWER' }), false);
  assert.equal(canManageAccounts({ role: 'ADMIN', scope: 'premeeting' }), false);
  assert.equal(canManageAccounts(undefined), false);
  const render = (access) => {
    globalThis.kpiEmployeeAccess = access;
    try { return renderToStaticMarkup(React.createElement(compile(React.useState))); } finally { delete globalThis.kpiEmployeeAccess; }
  };
  const owner = render({ role: 'OWNER', userId: 'synthetic' });
  assert.match(owner, /계정 관리 열기/);
  assert.equal((owner.match(/class="workspace-card"/g) || []).length, 4);
  assert.match(owner, /aria-label="계정 관리"/);
  const editor = render({ role: 'EDITOR', userId: 'synthetic' });
  assert.doesNotMatch(editor, /계정 관리/);
  assert.equal((editor.match(/class="workspace-card"/g) || []).length, 3);
  let state = INITIAL_WORKSPACE;
  state = selectWorkspace(state, ACCOUNT_WORKSPACE.id);
  assert.deepEqual([state.active, state.accountsOpened, state.kpiOpened], ['accounts', true, false]);
});
