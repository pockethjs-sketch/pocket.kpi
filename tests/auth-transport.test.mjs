import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthFetch, boundedAuthOperation, loginErrorMessage } from '../src/data/authTransport.js';

test('authentication transport preserves success JSON and denial status', async () => {
  for (const status of [200, 400, 401, 403, 429]) {
    const response = await createAuthFetch(async () => new Response('{"synthetic":true}', { status, headers: { 'content-type': 'application/json' } }))('https://example.invalid');
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { synthetic: true });
  }
});
test('hung transport is aborted once; no automatic password/signup retry', async () => {
  let signal, calls = 0;
  const fetcher = createAuthFetch((_url, init) => { calls++; signal = init.signal; return new Promise(() => {}); }, 10);
  await assert.rejects(fetcher('https://example.invalid'), /auth_network_timeout/);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});
test('HTTP headers alone do not defeat body timeout', async () => {
  const fetcher = createAuthFetch(async () => ({ arrayBuffer: () => new Promise(() => {}) }), 10);
  await assert.rejects(fetcher('https://example.invalid'), /auth_network_timeout/);
});
test('a subsequent manual login can succeed after a cancelled request', async () => {
  let calls = 0;
  const fetcher = createAuthFetch(async () => ++calls === 1 ? new Promise(() => {}) : new Response('{"ok":true}'), 10);
  await assert.rejects(fetcher('https://example.invalid'), /auth_network_timeout/);
  assert.deepEqual(await (await fetcher('https://example.invalid')).json(), { ok: true });
});
test('caller cancellation is forwarded to the request', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createAuthFetch(async (_url, init) => { init.signal.throwIfAborted(); })('https://example.invalid', { signal: controller.signal }), { name: 'AbortError' });
});
test('SDK lock watchdog distinguishes reload recovery from network retry', async () => {
  await assert.rejects(boundedAuthOperation(new Promise(() => {}), 10), /auth_session_timeout/);
  assert.equal(await boundedAuthOperation(Promise.resolve('ok'), 10), 'ok');
  assert.match(loginErrorMessage(new Error('auth_session_timeout')), /다시 불러오기/);
  assert.match(loginErrorMessage(new Error('auth_network_timeout')), /다시 눌러/);
  assert.match(loginErrorMessage({ code: 'invalid_credentials' }), /이메일 또는 비밀번호/);
  assert.match(loginErrorMessage({ code: 'email_not_confirmed' }), /인증이 완료되지/);
});
