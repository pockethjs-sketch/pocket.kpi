import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildupRecorder } from '../src/data/buildupRecorder.js';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
function fakeWindow({ deny } = {}) {
  const tracks = [];
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || ''; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) }); setTimeout(() => this.onstop?.(), 0); }
  }
  const recognitions = [];
  class FakeSpeech {
    constructor() { recognitions.push(this); this.started = 0; }
    start() { this.started++; }
    stop() { this.stopped = true; }
    say(text) { const result = [{ transcript: text }]; result.isFinal = true; this.onresult?.({ resultIndex: 0, results: [result] }); }
  }
  return {
    recognitions, tracks,
    win: {
      Blob, MediaRecorder: FakeRecorder, webkitSpeechRecognition: FakeSpeech,
      navigator: {
        permissions: { query: async () => ({ state: deny ? 'denied' : 'granted' }) },
        mediaDevices: {
          getUserMedia: async () => {
            if (deny) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
            const track = { stop() { this.stopped = true; } };
            tracks.push(track);
            return { getTracks: () => tracks, getAudioTracks: () => tracks };
          },
        },
      },
    },
  };
}

test('records in the page, forwards Korean transcript lines and hands over the audio file', async () => {
  const events = [], fake = fakeWindow();
  const recorder = createBuildupRecorder({ win: fake.win, onEvent: (event) => events.push(event) });
  assert.equal(recorder.supported(), true);
  assert.equal(recorder.srSupported(), true);
  await recorder.start({ base: 30, sr: true });
  assert.equal(recorder.state(), 'rec');
  assert.equal(fake.recognitions.at(-1).lang, 'ko-KR');
  fake.recognitions.at(-1).say('월 광고비는 삼백만 원입니다');
  const line = events.find((event) => event.type === 'line');
  assert.equal(line.text, '월 광고비는 삼백만 원입니다');
  assert.ok(line.t >= 30, 'timestamps continue from the previous recording length');
  recorder.pause();
  assert.equal(recorder.state(), 'paused');
  recorder.resume();
  recorder.stop();
  await tick(10);
  const result = events.find((event) => event.type === 'result');
  assert.ok(result.buffer instanceof ArrayBuffer && result.buffer.byteLength > 0);
  assert.equal(result.mime, 'audio/webm;codecs=opus');
  assert.ok(result.duration >= 30);
  assert.ok(fake.tracks.every((track) => track.stopped), 'microphone released after stop');
});

test('a blocked microphone reports cause and permission state instead of throwing raw errors', async () => {
  const recorder = createBuildupRecorder({ win: fakeWindow({ deny: true }).win });
  await assert.rejects(recorder.start({}), (error) => error.code === 'blocked' && error.name === 'NotAllowedError' && error.perm === 'denied');
  assert.equal(recorder.state(), 'idle');
});

test('closing the workspace releases the microphone without producing a file', async () => {
  const events = [], fake = fakeWindow();
  const recorder = createBuildupRecorder({ win: fake.win, onEvent: (event) => events.push(event) });
  await recorder.start({ sr: false });
  recorder.dispose();
  await tick(10);
  assert.equal(events.some((event) => event.type === 'result'), false);
  assert.ok(fake.tracks.every((track) => track.stopped));
  assert.equal(recorder.state(), 'idle');
});
