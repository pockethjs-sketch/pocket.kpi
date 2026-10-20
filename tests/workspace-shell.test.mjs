import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { WORKSPACES, MARKETING_HUB, INITIAL_WORKSPACE, selectWorkspace, BUILDUP_SANDBOX, BUILDUP_CSP, prepareBuildupDocument } from '../src/data/workspaces.js';

const shellSource = readFileSync(new URL('../src/WorkspaceShell.jsx', import.meta.url), 'utf8');
const frameSource = readFileSync(new URL('../src/BuildupWorkspace.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const source = shellSource.replace(/^import .*\r?\n/gm, '').replace('export default ', '');
const { code } = await transformWithOxc(source, 'WorkspaceShell.jsx', { jsx: { runtime: 'classic' } });
const icon = () => null;
function compile(useState, BuildupWorkspace = () => null) {
  return new Function('React', 'useState', 'WORKSPACES', 'MARKETING_HUB', 'INITIAL_WORKSPACE', 'selectWorkspace', 'BuildupWorkspace', 'ArrowRight', 'ChartNoAxesCombined', 'Layers3', 'LayoutGrid', code + ';return WorkspaceShell;')(
    React, useState, WORKSPACES, MARKETING_HUB, INITIAL_WORKSPACE, selectWorkspace, BuildupWorkspace, icon, icon, icon, icon,
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
  assert.doesNotMatch(shellSource + frameSource, /localStorage|sessionStorage|fetch\(|employeeRequest|postMessage/);
  assert.match(main, /<WorkspaceShell onSignOut=\{\(\) => window.kpiSignOut\(\)\}><KpiWorkspace \/><\/WorkspaceShell>/);
  const entry = readFileSync(new URL('../src/EmployeeEntry.jsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("await employeeRequest('session')") < entry.indexOf("await import('./main.jsx')"));
  assert.match(main, /if \(!window.kpiEmployeeAccess\?\.userId\) throw new Error\('employee_login_required'\)/);
});

test('provided standalone document is byte-preserved, syntactically valid, and isolated from KPI credentials', () => {
  const raw = readFileSync(new URL('../src/assets/buildup-intelligence-v3.html', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), '367d69ea4ec012cc5a28a066c6765af90f98e96b2b47a2761e8c6db9559d0a99');
  const html = raw.toString('utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 4);
  for (const [index, match] of scripts.entries()) new vm.Script(match[1], { filename: 'buildup-inline-' + index + '.js' });
  const prepared = prepareBuildupDocument(html);
  assert.ok(prepared.indexOf('Content-Security-Policy') < prepared.indexOf('<script>'));
  assert.equal(prepared.replace(`<meta http-equiv="Content-Security-Policy" content="${BUILDUP_CSP}">`, ''), html);
  assert.doesNotMatch(BUILDUP_SANDBOX, /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.match(BUILDUP_CSP, /connect-src 'none'/);
  assert.match(frameSource, /sandbox=\{BUILDUP_SANDBOX\}/);
  assert.match(frameSource, /microphone 'none'/);
  assert.match(frameSource, /현재 창에서만 유지/);
  assert.match(frameSource, /\.catch\(/);
  assert.throws(() => prepareBuildupDocument('invalid'), /buildup_document_invalid/);
});
