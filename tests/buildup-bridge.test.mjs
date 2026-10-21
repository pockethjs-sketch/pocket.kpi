import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuildupBridge, validateBridgeMessage, bridgeError, BUILDUP_BRIDGE_OPS, BUILDUP_BRIDGE_LIMITS } from '../src/data/buildupBridge.js';

const OTHER = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(overrides = {}) {
  const sent = [], calls = [], rec = { started: [], log: [] };
  const recorder = {
    start: async (options) => { rec.started.push(options); if (overrides.recFail) throw overrides.recFail; },
    pause: () => rec.log.push('pause'), resume: () => rec.log.push('resume'), stop: () => rec.log.push('stop'), setSr: (on) => rec.log.push('sr:' + on),
  };
  const prefsStore = { value: { theme: 'dark' } };
  const bridge = createBuildupBridge({
    post: (message, transfer) => sent.push({ message, transfer }),
    call: overrides.call || (async (op, args) => { calls.push([op, args]); return { ok: true, op, echo: args }; }),
    aiStream: overrides.aiStream || (async (args, signal, onText) => { onText('안'); onText('안녕'); return { text: '안녕', model: args.model, truncated: false }; }),
    recorder, prefs: { get: () => prefsStore.value, set: (value) => { prefsStore.value = value; } },
    onUiState: (state) => { rec.ui = state; },
  });
  return { bridge, sent, calls, rec, prefsStore };
}

test('only known operations with well-formed arguments pass the bridge', () => {
  assert.ok(BUILDUP_BRIDGE_OPS.includes('save') && BUILDUP_BRIDGE_OPS.includes('rec.start'));
  assert.equal(validateBridgeMessage({ id: 'r1', op: 'session' }).op, 'session');
  for (const bad of [
    null, 'session', { op: 'sql', args: {} }, { op: 'session', id: 'x'.repeat(41) }, { op: 'session', args: [] },
    { op: 'get', args: { id: '../etc' } }, { op: 'get', args: { id: 'p1', ownerId: 'not-uuid' } },
    { op: 'save', args: { id: 'p1', core: { id: 'p2' }, summary: {} } },
    { op: 'save', args: { id: 'p1', core: { id: 'p1' }, summary: {}, baseRevision: 1.5 } },
    { op: 'ai', args: { model: 'm', max_tokens: 10, messages: [{ role: 'system', content: 'x' }] } },
    { op: 'ai', args: { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'x' }], effort: 'max' } },
    { op: 'prefs.set', args: { prefs: { big: 'x'.repeat(BUILDUP_BRIDGE_LIMITS.prefsBytes) } } },
    { op: 'rec.sr', args: { on: 'yes' } },
    { op: 'list', args: { scope: 'everyone' } },
  ]) assert.equal(validateBridgeMessage(bad), null, JSON.stringify(bad)?.slice(0, 80));
  const big = { id: 'p1', core: { id: 'p1' }, summary: {}, heavy: { t: 'x'.repeat(BUILDUP_BRIDGE_LIMITS.saveBytes) } };
  assert.equal(validateBridgeMessage({ id: 'r2', op: 'save', args: big }), null);
  assert.equal(validateBridgeMessage({ id: 'r3', op: 'get', args: { id: 'p1', ownerId: OTHER } }).args.ownerId, OTHER);
  assert.equal(validateBridgeMessage({ id: 'r4', op: 'ai', args: { model: 'claude-haiku-5-5', max_tokens: 4000, messages: [{ role: 'user', content: 'x' }], effort: 'low' } }).args.effort, 'low');
});

test('server operations are forwarded without credentials and answered by request id', async () => {
  const { bridge, sent, calls } = harness();
  assert.equal(bridge.handle({ id: 'r1', op: 'list', args: { scope: 'all' } }), true);
  assert.equal(bridge.handle({ id: 'r2', op: 'unknown' }), false);
  await tick();
  assert.deepEqual(calls, [['list', { scope: 'all' }]]);
  assert.deepEqual(sent[0].message, { id: 'r1', ok: true, data: { op: 'list', echo: { scope: 'all' } } });
  assert.doesNotMatch(JSON.stringify(sent), /Bearer|access_token|apikey|sb_publishable/i);
});

test('server failures reach the frame as short codes only', async () => {
  const failing = Object.assign(new Error('conflict'), { code: 'conflict', revision: 7, stack: 'secret stack', payload: { core: 1 } });
  const { bridge, sent } = harness({ call: async () => { throw failing; } });
  bridge.handle({ id: 'r1', op: 'save', args: { id: 'p1', core: { id: 'p1' }, summary: {}, baseRevision: 6 } });
  await tick();
  assert.deepEqual(sent[0].message, { id: 'r1', ok: false, error: { code: 'conflict', revision: 7, message: 'conflict' } });
  assert.deepEqual(bridgeError(new Error('Something <odd>')), { code: 'bridge_error', message: 'Something <odd>' });
});

test('AI streams as throttled deltas, then a final answer; abort cancels the request', async () => {
  const { bridge, sent } = harness();
  bridge.handle({ id: 'a1', op: 'ai', args: { model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }], stream: true } });
  await tick(); await tick();
  const final = sent.find(s => s.message.id === 'a1' && s.message.ok);
  assert.deepEqual(final.message.data, { text: '안녕', model: 'claude-opus-5-5', truncated: false });
  assert.ok(sent.some(s => s.message.ev === 'delta' && s.message.text === '안'));
  let aborted = false;
  const slow = harness({ aiStream: (args, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }); }) });
  slow.bridge.handle({ id: 'a2', op: 'ai', args: { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] } });
  slow.bridge.handle({ op: 'abort', args: { target: 'a2' } });
  await tick(); await tick();
  assert.equal(aborted, true);
  assert.equal(slow.sent.at(-1).message.error.code, 'cancelled');
});

test('recording commands drive the page recorder and events return to the frame', async () => {
  const { bridge, sent, rec } = harness();
  bridge.handle({ id: 's1', op: 'rec.start', args: { base: 12, sr: true } });
  bridge.handle({ op: 'rec.pause' }); bridge.handle({ op: 'rec.resume' }); bridge.handle({ op: 'rec.sr', args: { on: false } }); bridge.handle({ op: 'rec.stop' });
  await tick();
  assert.deepEqual(rec.started, [{ base: 12, sr: true }]);
  assert.deepEqual(rec.log, ['pause', 'resume', 'sr:false', 'stop']);
  bridge.recorderEvent({ type: 'line', text: '안녕하세요', t: 3.6 });
  const buffer = new ArrayBuffer(8);
  bridge.recorderEvent({ type: 'result', buffer, mime: 'audio/webm', duration: 61 });
  const line = sent.find(s => s.message.type === 'line'), result = sent.find(s => s.message.type === 'result');
  assert.deepEqual(line.message, { ev: 'rec', type: 'line', text: '안녕하세요', t: 3.6 });
  assert.equal(result.transfer[0], buffer);
  const denied = harness({ recFail: { code: 'blocked', name: 'NotAllowedError', perm: 'denied', detail: 'Permission denied', stream: {} } });
  denied.bridge.handle({ id: 's2', op: 'rec.start', args: {} });
  await tick();
  assert.deepEqual(denied.sent[0].message.error, { code: 'blocked', name: 'NotAllowedError', detail: 'Permission denied', perm: 'denied' });
});

test('preferences and save/recording state stay in the page', async () => {
  const { bridge, sent, rec, prefsStore } = harness();
  bridge.handle({ id: 'p1', op: 'prefs.get' });
  bridge.handle({ op: 'prefs.set', args: { prefs: { theme: 'light' } } });
  bridge.handle({ op: 'ui.state', args: { pending: true, recording: false } });
  await tick();
  assert.deepEqual(sent[0].message.data, { prefs: { theme: 'dark' } });
  assert.deepEqual(prefsStore.value, { theme: 'light' });
  assert.deepEqual(rec.ui, { pending: true, recording: false });
  bridge.close();
  assert.equal(bridge.handle({ id: 'x', op: 'session' }), false);
});

test('workspace wires a private channel per frame load and keeps the frame isolated', () => {
  const frame = readFileSync(new URL('../src/BuildupWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(frame, /new MessageChannel\(\)/);
  assert.match(frame, /onLoad=\{connect\}/);
  assert.match(frame, /postMessage\(\{ type: 'pk-bridge', v: BUILDUP_BRIDGE_VERSION, rec: \{ rec: rec\.supported\(\), sr: rec\.srSupported\(\) \} \}, '\*', \[channel\.port2\]\)/);
  assert.doesNotMatch(frame, /employeeHeaders|access_token|localStorage|sessionStorage|fetch\(/);
  const api = readFileSync(new URL('../src/data/buildupApi.js', import.meta.url), 'utf8');
  assert.match(api, /functions\/v1\/kpi-buildup-api/);
  assert.match(api, /kpiEmployeeStorage/);
  assert.doesNotMatch(api, /window\.localStorage|anthropic\.com|x-api-key/);
});
