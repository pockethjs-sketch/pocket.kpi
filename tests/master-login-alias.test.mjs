import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeMasterSetupToken, isMasterLoginAlias, isPlausibleEmail } from '../src/data/masterLoginAlias.js';

test('MASTER is accepted case-insensitively without an email alias', () => {
  assert.equal(isMasterLoginAlias('MASTER'), true);
  assert.equal(isMasterLoginAlias(' master '), true);
});

test('ordinary employees continue to require their own email', () => {
  assert.equal(isMasterLoginAlias('employee@example.com'), false);
  assert.equal(isPlausibleEmail('employee@example.com'), true);
});

test('invalid employee identifiers are rejected as email', () => {
  assert.equal(isPlausibleEmail(''), false);
  assert.equal(isPlausibleEmail('MASTER'), false);
});

test('one-time setup token is removed from the address bar and retained only for the tab', () => {
  const values = new Map();
  let replaced = '';
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) || '' };
  const token = consumeMasterSetupToken(
    { href: 'https://example.test/pocket.kpi/?master_setup=one-time-token&view=home#top' },
    { replaceState: (_state, _title, url) => { replaced = url; } },
    storage,
  );
  assert.equal(token, 'one-time-token');
  assert.equal(values.get('pocket-kpi:master-setup-token:v1'), 'one-time-token');
  assert.equal(replaced, '/pocket.kpi/?view=home#top');
});
