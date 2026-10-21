import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUDIO_BUCKET, AUDIO_LIMITS, audioMime, audioPath, validateAudioUpload, cleanKeywords, validateTranscribe, clovaRequest,
  clovaStartError, clovaResult, recordingItem, transcribeRateLimited, processingIsStale, newCallbackSecret, secretHash, sameDigest,
} from '../supabase/functions/_shared/buildup-audio.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const api = read('../supabase/functions/kpi-buildup-api/index.ts');
const callback = read('../supabase/functions/kpi-buildup-stt-callback/index.ts');
const config = read('../supabase/config.toml');
const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '11111111-1111-4111-8111-111111111111';
const REC = '33333333-3333-4333-8333-333333333333';

test('uploads accept known audio types within limits and get a private per-owner path', () => {
  assert.equal(audioMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(audioMime('text/html'), null);
  const ok = validateAudioUpload({ projectId: 'p1', audioKey: 'p1-1729500000000', mime: 'audio/webm;codecs=opus', bytes: 1234, duration: 61.4 });
  assert.deepEqual(ok.value, { projectId: 'p1', audioKey: 'p1-1729500000000', mime: 'audio/webm', bytes: 1234, duration: 61 });
  assert.equal(audioPath(ORG, OWNER, 'p1', REC, 'audio/webm'), `${ORG}/${OWNER}/p1/${REC}.webm`);
  assert.equal(audioPath(ORG, OWNER, 'p1', REC, 'audio/x-m4a'), `${ORG}/${OWNER}/p1/${REC}.m4a`);
  for (const [bad, error] of [
    [{ projectId: '../x', audioKey: 'a', mime: 'audio/webm', bytes: 1 }, 'invalid_recording'],
    [{ projectId: 'p1', audioKey: 'a/b', mime: 'audio/webm', bytes: 1 }, 'invalid_recording'],
    [{ projectId: 'p1', audioKey: 'a', mime: 'application/pdf', bytes: 1 }, 'audio_type_not_allowed'],
    [{ projectId: 'p1', audioKey: 'a', mime: 'audio/webm', bytes: 0 }, 'invalid_recording'],
    [{ projectId: 'p1', audioKey: 'a', mime: 'audio/webm', bytes: AUDIO_LIMITS.maxBytes + 1 }, 'audio_too_large'],
    [{ projectId: 'p1', audioKey: 'a', mime: 'audio/webm', bytes: 10, duration: -1 }, 'invalid_recording'],
  ]) assert.equal(validateAudioUpload(bad).error, error, JSON.stringify(bad));
});

test('CLOVA request: Korean, async callback, fixed speaker count and cleaned boost words only', () => {
  assert.deepEqual(cleanKeywords(['포켓', '포켓', '빌드업', 'IR', '네', 'B2B', 'x'.repeat(31), '  투자  유치 ', 3, '<b>']), ['포켓', '빌드업', 'IR', '투자 유치']);
  const body = clovaRequest({ url: 'https://example.invalid/a.webm?token=t', callback: 'https://example.invalid/cb', speakers: 2, keywords: ['포켓', '빌드업'] });
  assert.deepEqual(body, {
    url: 'https://example.invalid/a.webm?token=t', language: 'ko-KR', completion: 'async', callback: 'https://example.invalid/cb',
    wordAlignment: false, fullText: false, noiseFiltering: true,
    diarization: { enable: true, speakerCountMin: 2, speakerCountMax: 2 }, boostings: [{ words: '포켓,빌드업' }],
  });
  assert.deepEqual(clovaRequest({ url: 'u', callback: 'c', speakers: 0 }).diarization, { enable: true });
  assert.equal('boostings' in clovaRequest({ url: 'u', callback: 'c', keywords: [] }), false);
  assert.equal(validateTranscribe({ recordingId: REC, speakers: 5 }).ok, false);
  assert.deepEqual(validateTranscribe({ recordingId: REC }).value, { recordingId: REC, speakers: 2, keywords: [] });
  assert.deepEqual(clovaStartError(401), { status: 503, error: 'stt_key_invalid' });
  assert.deepEqual(clovaStartError(500), { status: 502, error: 'stt_upstream_error' });
});

test('CLOVA results keep only times, speaker labels and text; failures become short codes', () => {
  const payload = {
    result: 'COMPLETED', token: 't', text: '전체 글', params: { userdata: { secret: 'x' } },
    segments: [
      { start: 5870, end: 8160, text: '안녕하세요  포켓입니다', confidence: 0.96269, speaker: { label: '1', name: 'A' }, diarization: { label: '1' }, words: [[5871, 6730, '안녕하세요']] },
      { start: 1000, end: 2000, text: '네 반갑습니다', textEdited: '네, 반갑습니다', diarization: { label: '2' } },
      { start: 9000, end: 9500, text: '   ' },
      'nope',
    ],
  };
  const parsed = clovaResult(payload);
  assert.deepEqual(parsed, { status: 'done', speakers: ['2', '1'], segments: [
    { s: 1000, e: 2000, sp: '2', text: '네, 반갑습니다' },
    { s: 5870, e: 8160, sp: '1', text: '안녕하세요 포켓입니다', c: 0.96 },
  ] });
  assert.doesNotMatch(JSON.stringify(parsed), /secret|words|전체 글/);
  assert.deepEqual(clovaResult({ result: 'FAILED', message: 'Invalid media' }), { status: 'failed', error: 'stt_failed' });
  assert.deepEqual(clovaResult(null), { status: 'failed', error: 'stt_bad_result' });
  const many = clovaResult({ result: 'COMPLETED', segments: Array.from({ length: AUDIO_LIMITS.segments + 5 }, (_, i) => ({ start: i, end: i, text: 'x'.repeat(AUDIO_LIMITS.segmentChars + 9) })) });
  assert.equal(many.segments.length, AUDIO_LIMITS.segments);
  assert.equal(many.segments[0].text.length, AUDIO_LIMITS.segmentChars);
});

test('recording rows reach the screen without storage paths, job tokens or callback secrets', () => {
  const item = recordingItem({ id: REC, audio_key: 'k1', status: 'done', bytes: '42', duration_sec: 61, speakers: 2, error_code: null, requested_at: 'r', completed_at: 'c', created_at: 'a',
    storage_path: `${ORG}/${OWNER}/p1/${REC}.webm`, stt_token: 'job', callback_hash: 'f'.repeat(64), result: { segments: [] } });
  assert.deepEqual(Object.keys(item).sort(), ['audioKey', 'bytes', 'completedAt', 'createdAt', 'duration', 'errorCode', 'recordingId', 'requestedAt', 'speakers', 'status']);
  assert.equal(transcribeRateLimited(AUDIO_LIMITS.transcribePerHour - 1), false);
  assert.equal(transcribeRateLimited(AUDIO_LIMITS.transcribePerHour), true);
  assert.equal(transcribeRateLimited(null), true);
  assert.equal(processingIsStale(new Date().toISOString()), false);
  assert.equal(processingIsStale(new Date(Date.now() - AUDIO_LIMITS.staleProcessingMs - 1000).toISOString()), true);
});

test('callback secrets are random, stored only as SHA-256 and compared in constant time', async () => {
  const a = newCallbackSecret(), b = newCallbackSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  const hash = await secretHash(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, a);
  assert.equal(sameDigest(hash, await secretHash(a)), true);
  assert.equal(sameDigest(hash, await secretHash(b)), false);
  assert.equal(sameDigest(hash, null), false);
});

test('API: recording actions run after the employee checks, scope rows to the organization and owner', () => {
  const start = api.indexOf('if (action === "audioUpload")'), end = api.indexOf('if (action === "usage")');
  const block = api.slice(start, end);
  assert.ok(start > api.indexOf('if (!canUseBuildup(access))') && block.length > 2000);
  assert.match(block, /from\("buildup_projects"\)\.select\("project_id"\)\s*\.eq\("organization_id", organizationId\)\.eq\("owner_user_id", me\)/, 'uploads only into my own saved project');
  assert.match(block, /createSignedUploadUrl\(row\.storage_path/);
  assert.match(block, /canReadBuildupOwner\(access, ownerId\)/, 'others are read-only for OWNER/ADMIN');
  assert.match(block, /createSignedUrl\(row\.storage_path, AUDIO_LIMITS\.playUrlSec\)/);
  const transcribe = block.slice(block.indexOf('if (action === "transcribe")'));
  assert.match(transcribe, /Deno\.env\.get\("CLOVA_SPEECH_INVOKE_URL"\)/);
  assert.match(transcribe, /"X-CLOVASPEECH-API-KEY": sttSecret/);
  assert.match(transcribe, /\.eq\("owner_user_id", me\)\.eq\("id", value\.recordingId\)/, 'only my own recordings are transcribed');
  assert.match(transcribe, /transcribeRateLimited\(count\)/);
  assert.match(transcribe, /callback_hash: await secretHash\(callbackSecret\)/, 'only the hash of the callback secret is stored');
  assert.ok(transcribe.indexOf('callback_hash: await secretHash') < transcribe.indexOf('await fetch('), 'job marked before CLOVA can call back');
  assert.doesNotMatch(block, /reply\([^)]*(sttSecret|callbackSecret|stt_token|callback_hash)/, 'secrets never reach a response');
  assert.match(block, /AUDIO_BUCKET/);
  assert.equal(AUDIO_BUCKET, 'buildup-audio');
});

test('callback: no Supabase JWT, but a single-use per-recording secret; writes only that recording', () => {
  assert.match(config, /\[functions\.kpi-buildup-stt-callback\]\s*\nverify_jwt = false/);
  assert.match(callback, /req\.method !== "POST"/);
  assert.match(callback, /RECORDING_ID\.test\(recordingId\)/);
  assert.match(callback, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(secret\)/);
  assert.match(callback, /row\.status !== "processing" \|\| !sameDigest\(await secretHash\(secret\), row\.callback_hash\)/);
  assert.ok(callback.indexOf('sameDigest(') < callback.indexOf('req.text()'), 'body is read only after the secret matches');
  assert.match(callback, /callback_hash: null/, 'secret cleared on use');
  assert.match(callback, /\.eq\("id", recordingId\)\.eq\("status", "processing"\)\.eq\("callback_hash", row\.callback_hash\)/);
  assert.doesNotMatch(callback, /console\.(log|info|debug|warn|error)/);
  assert.doesNotMatch(callback, /access-control-allow-origin/);
  assert.doesNotMatch(callback, /json\(\{[^}]*(segments|result|text)/, 'nothing is read back to the caller');
});

test('migration: server-only recordings table and a private bucket without browser policies', () => {
  const sql = read('../supabase/migrations/20261021053437_buildup_recordings.sql');
  assert.match(sql, /create table if not exists public\.buildup_recordings/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public\.buildup_recordings from anon, authenticated/);
  assert.match(sql, /callback_hash text/);
  assert.match(sql, /insert into storage\.buckets \(id, name, public, allowed_mime_types\)\s*values \('buildup-audio', 'buildup-audio', false/);
  assert.doesNotMatch(sql, /create policy|grant [^;]*(anon|authenticated)|security definer/i);
});
