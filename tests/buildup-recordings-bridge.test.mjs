import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuildupBridge, validateBridgeMessage, BUILDUP_BRIDGE_LIMITS } from '../src/data/buildupBridge.js';
import { createBuildupRecorder } from '../src/data/buildupRecorder.js';

const REC = '33333333-3333-4333-8333-333333333333';
const OTHER = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function harness(audio) {
  const sent = [], calls = [];
  const bridge = createBuildupBridge({
    post: (message, transfer) => sent.push({ message, transfer }),
    call: async (op, args) => { calls.push([op, args]); return { ok: true, op }; },
    aiStream: async () => ({ text: '', model: '', truncated: false }),
    recorder: { start: async () => {}, pause() {}, resume() {}, stop() {}, setSr() {} },
    prefs: { get: () => ({}), set() {} }, audio,
  });
  return { bridge, sent, calls };
}

test('recording operations accept only well-formed arguments', () => {
  const buffer = new ArrayBuffer(8);
  assert.ok(validateBridgeMessage({ id: 'u1', op: 'audio.put', args: { projectId: 'p1', audioKey: 'p1-1729', mime: 'audio/webm;codecs=opus', duration: 61, buffer } }));
  assert.ok(validateBridgeMessage({ id: 'g1', op: 'audio.get', args: { projectId: 'p1', audioKey: 'p1-1729', ownerId: OTHER } }));
  assert.ok(validateBridgeMessage({ id: 't1', op: 'transcribe', args: { recordingId: REC, speakers: 2, keywords: ['포켓'] } }));
  assert.ok(validateBridgeMessage({ id: 'l1', op: 'recordings', args: { projectId: 'p1' } }));
  assert.ok(validateBridgeMessage({ id: 'r1', op: 'transcript', args: { recordingId: REC, ownerId: OTHER } }));
  for (const [op, args] of [
    ['audio.put', { projectId: 'p1', audioKey: 'k', mime: 'audio/webm', duration: 1, buffer: 'bytes' }],
    ['audio.put', { projectId: 'p1', audioKey: 'k', mime: 'text/html', duration: 1, buffer }],
    ['audio.put', { projectId: '../p', audioKey: 'k', mime: 'audio/webm', duration: 1, buffer }],
    ['audio.put', { projectId: 'p1', audioKey: 'k', mime: 'audio/webm', duration: 1, buffer: new ArrayBuffer(0) }],
    ['audio.put', { projectId: 'p1', audioKey: 'k', mime: 'audio/webm', duration: 1, buffer, path: 'x' }],
    ['audio.get', { projectId: 'p1', audioKey: 'k/../x' }],
    ['transcribe', { recordingId: 'nope' }],
    ['transcribe', { recordingId: REC, speakers: 7 }],
    ['transcribe', { recordingId: REC, keywords: Array(BUILDUP_BRIDGE_LIMITS.keywords + 1).fill('a') }],
    ['transcribe', { recordingId: REC, url: 'https://evil.invalid' }],
    ['recordings', { projectId: 'p1', ownerId: 'x' }],
  ]) assert.equal(validateBridgeMessage({ id: 'b1', op, args }), null, op + ' ' + JSON.stringify(Object.keys(args)));
});

test('audio.put hands the bytes to the page uploader and returns only the recording id to the frame', async () => {
  const seen = [];
  const { bridge, sent } = harness({
    put: async (meta, buffer) => { seen.push([meta, buffer.byteLength]); return { recordingId: REC, bytes: 8, path: 'org/user/p1/x.webm', token: 'upload-token' }; },
    get: async () => ({ buffer: new ArrayBuffer(4), mime: 'audio/webm' }),
  });
  bridge.handle({ id: 'u1', op: 'audio.put', args: { projectId: 'p1', audioKey: 'p1-1', mime: 'audio/webm', duration: 3, buffer: new ArrayBuffer(8) } });
  await tick(); await tick();
  assert.deepEqual(seen, [[{ projectId: 'p1', audioKey: 'p1-1', mime: 'audio/webm', duration: 3 }, 8]]);
  assert.deepEqual(sent[0].message, { id: 'u1', ok: true, data: { recordingId: REC, bytes: 8, already: false } });
  assert.doesNotMatch(JSON.stringify(sent), /upload-token|org\/user/);
});

test('audio.get returns the recording to the frame as a transferred buffer', async () => {
  const { bridge, sent } = harness({ put: async () => ({}), get: async (args) => ({ buffer: new ArrayBuffer(4), mime: 'audio/webm', args }) });
  bridge.handle({ id: 'g1', op: 'audio.get', args: { projectId: 'p1', audioKey: 'p1-1' } });
  await tick(); await tick();
  assert.equal(sent[0].message.id, 'g1');
  assert.equal(sent[0].message.ok, true);
  assert.ok(sent[0].message.data.buffer instanceof ArrayBuffer);
  assert.deepEqual(sent[0].transfer, [sent[0].message.data.buffer]);
  const none = harness(undefined);
  none.bridge.handle({ id: 'g2', op: 'audio.get', args: { projectId: 'p1', audioKey: 'p1-1' } });
  await tick();
  assert.equal(none.sent[0].message.error.code, 'not_supported');
});

test('transcription status operations go to the server like the other read operations', async () => {
  const { bridge, calls } = harness({ put: async () => ({}), get: async () => ({}) });
  bridge.handle({ id: 't1', op: 'transcribe', args: { recordingId: REC, speakers: 2, keywords: ['포켓'] } });
  bridge.handle({ id: 'l1', op: 'recordings', args: { projectId: 'p1' } });
  bridge.handle({ id: 'r1', op: 'transcript', args: { recordingId: REC } });
  await tick();
  assert.deepEqual(calls.map((c) => c[0]), ['transcribe', 'recordings', 'transcript']);
});

test('the page wires the uploader into the bridge; signed upload happens in the API module, not the frame shell', () => {
  const shell = read('../src/BuildupWorkspace.jsx'), api = read('../src/data/buildupApi.js');
  assert.match(shell, /audio: \{ put: buildupAudioPut, get: buildupAudioGet \}/);
  assert.match(api, /buildupCall\('audioUpload'/);
  assert.match(api, /uploadToSignedUrl\(prepared\.path, prepared\.token/);
  assert.match(api, /buildupCall\('audioUploaded'/);
  assert.match(api, /buildupCall\('audioUrl'/);
});

test('speech is recorded at 32 kbps so long meetings stay small', async () => {
  let options = null;
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, opts) { options = opts; this.mimeType = opts?.mimeType || ''; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
  }
  const track = { stop() {} };
  const recorder = createBuildupRecorder({ win: { Blob, MediaRecorder: FakeRecorder, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } } } });
  await recorder.start({ sr: false });
  assert.deepEqual(options, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
  recorder.dispose();
});
