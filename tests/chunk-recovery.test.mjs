import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshEntryUrl, isChunkLoadError, recoverChunkLoad } from '../src/data/chunkRecovery.js';

const chunkError = new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/main-old.js');
function harness() {
  const values = new Map([['employee-session', 'synthetic-session'], ['pending-journal', 'synthetic-unsaved-edit']]);
  const navigations = [];
  return { values, navigations, deps: {
    now: 1000000, online: true,
    storage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    location: { href: 'https://example.test/pocket.kpi/?view=deals#balance', replace: url => navigations.push(url) },
  } };
}
test('chunk transport failures recognized, auth and runtime failures not reloaded', () => {
  for (const message of [chunkError.message, 'error loading dynamically imported module', 'Importing a module script failed.', 'Unable to preload CSS for /assets/style.css']) assert.equal(isChunkLoadError(Error(message)), true);
  for (const message of ['invalid_credentials', 'employee_approval_required', 'Failed to fetch', 'Cannot read properties of undefined']) assert.equal(isChunkLoadError(Error(message)), false);
});
test('stale entry recovers once with same origin, session and unsaved data intact', () => {
  const { deps, values, navigations } = harness();
  assert.equal(recoverChunkLoad(chunkError, deps), true);
  assert.equal(recoverChunkLoad(chunkError, deps), false);
  const url = new URL(navigations[0]);
  assert.equal(url.origin, 'https://example.test');
  assert.equal(url.pathname, '/pocket.kpi/');
  assert.equal(url.searchParams.get('view'), 'deals');
  assert.equal(url.searchParams.get('_kpi_reload'), '1000000');
  assert.equal(url.hash, '#balance');
  assert.equal(values.get('employee-session'), 'synthetic-session');
  assert.equal(values.get('pending-journal'), 'synthetic-unsaved-edit');
  assert.equal(navigations.length, 1);
});
test('guard survives fresh page, stops clock-skew loops, and expires for future deployments', () => {
  const { deps, navigations } = harness();
  recoverChunkLoad(chunkError, deps);
  assert.equal(recoverChunkLoad(chunkError, { ...deps, now: 999999 }), false);
  assert.equal(recoverChunkLoad(chunkError, { ...deps, now: 1600001 }), true);
  assert.equal(navigations.length, 2);
});
test('offline, unavailable storage and auth failure stay put with manual recovery available', () => {
  const { deps, navigations } = harness();
  assert.equal(recoverChunkLoad(chunkError, { ...deps, online: false }), false);
  assert.equal(recoverChunkLoad(chunkError, { ...deps, storage: { getItem: () => { throw Error('blocked'); } } }), false);
  assert.equal(recoverChunkLoad(Error('invalid_credentials'), deps), false);
  assert.equal(navigations.length, 0);
  assert.equal(new URL(freshEntryUrl(deps.location.href, 2)).searchParams.get('_kpi_reload'), '2');
});
test('entry authorizes before import and only handles transport failure inside the import phase', () => {
  const entry = readFileSync(new URL('../src/EmployeeEntry.jsx', import.meta.url), 'utf8');
  assert.ok(entry.indexOf("await employeeRequest('session')") < entry.indexOf('loadingApp = true'));
  assert.ok(entry.indexOf('loadingApp = true') < entry.indexOf("await import('./main.jsx')"));
  assert.match(entry, /alive && loadingApp && isChunkLoadError\(error\)/);
  assert.match(entry, /최신 화면 다시 불러오기/);
  assert.doesNotMatch(readFileSync(new URL('../src/data/chunkRecovery.js', import.meta.url), 'utf8'), /signOut|\.clear\(|removeItem/);
});
