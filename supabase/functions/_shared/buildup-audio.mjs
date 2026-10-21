// Meeting recordings for the buildup workspace (kpi-buildup-api + kpi-buildup-stt-callback). Pure helpers, unit-tested.
// - Audio is kept in the private Storage bucket `buildup-audio` at <organization>/<owner>/<project>/<recording>.<ext>.
//   It is never public: the Edge Function hands out short-lived signed URLs only after the employee checks.
// - Precise transcription uses CLOVA Speech long-form recognition (Korean, speaker diarization, keyword boosting),
//   asynchronously, with a single-use per-recording callback secret. Only segment times, speaker labels and text are kept.

export const AUDIO_BUCKET = 'buildup-audio';
export const AUDIO_KEY = /^[A-Za-z0-9_-]{1,120}$/;
export const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const AUDIO_LIMITS = Object.freeze({
  maxBytes: 500 * 1024 * 1024,
  maxDurationSec: 6 * 3600,
  keywords: 200,
  keywordChars: 30,
  segments: 20_000,
  segmentChars: 2_000,
  callbackBytes: 30_000_000,
  transcribePerHour: 20,
  staleProcessingMs: 2 * 3_600_000,
  mediaUrlSec: 6 * 3600,
  playUrlSec: 600,
  listRows: 200,
});

// Speaker counts the screen offers: 2 (default), 3, 4, or 0 = let the engine decide.
export const SPEAKER_CHOICES = Object.freeze([0, 2, 3, 4]);

const MIME_EXT = Object.freeze({
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'video/mp4': 'mp4',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/aac': 'aac', 'audio/flac': 'flac',
});
export const AUDIO_MIMES = Object.freeze(Object.keys(MIME_EXT));

const fail = (status, error) => ({ ok: false, status, error });
const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// 'audio/webm;codecs=opus' → 'audio/webm'; unknown types → null.
export function audioMime(value) {
  const base = String(value || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ? base : null;
}

export function audioPath(organizationId, ownerId, projectId, recordingId, mime) {
  return `${organizationId}/${ownerId}/${projectId}/${recordingId}.${MIME_EXT[audioMime(mime)] || 'bin'}`;
}

export function validateAudioUpload(body) {
  const projectId = String(body?.projectId || ''), audioKey = String(body?.audioKey || '');
  if (!PROJECT_ID.test(projectId) || !AUDIO_KEY.test(audioKey)) return fail(400, 'invalid_recording');
  const mime = audioMime(body?.mime);
  if (!mime) return fail(415, 'audio_type_not_allowed');
  const bytes = body?.bytes, duration = body?.duration ?? 0;
  if (!Number.isInteger(bytes) || bytes < 1) return fail(400, 'invalid_recording');
  if (bytes > AUDIO_LIMITS.maxBytes) return fail(413, 'audio_too_large');
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > AUDIO_LIMITS.maxDurationSec) return fail(400, 'invalid_recording');
  return { ok: true, value: { projectId, audioKey, mime, bytes, duration: Math.round(duration) } };
}

// Boosted words: Korean/English only (CLOVA ignores other characters), 2–30 characters, de-duplicated, capped.
export function cleanKeywords(list) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const word = raw.replace(/\s+/g, ' ').trim();
    if (word.length < 2 || word.length > AUDIO_LIMITS.keywordChars || !/^[가-힣A-Za-z ]+$/.test(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(word);
    if (out.length >= AUDIO_LIMITS.keywords) break;
  }
  return out;
}

export function validateTranscribe(body) {
  const recordingId = String(body?.recordingId || '');
  if (!RECORDING_ID.test(recordingId)) return fail(400, 'invalid_recording');
  const speakers = body?.speakers ?? 2;
  if (!SPEAKER_CHOICES.includes(speakers)) return fail(400, 'invalid_recording');
  if (body?.keywords !== undefined && !Array.isArray(body.keywords)) return fail(400, 'invalid_recording');
  return { ok: true, value: { recordingId, speakers, keywords: cleanKeywords(body?.keywords) } };
}

// CLOVA Speech long-form request (POST {InvokeURL}/recognizer/url). Asynchronous: the result is posted to `callback`.
export function clovaRequest({ url, callback, speakers = 2, keywords = [] }) {
  const words = cleanKeywords(keywords);
  return {
    url, language: 'ko-KR', completion: 'async', callback,
    wordAlignment: false, fullText: false, noiseFiltering: true,
    diarization: speakers >= 2 ? { enable: true, speakerCountMin: speakers, speakerCountMax: speakers } : { enable: true },
    ...(words.length ? { boostings: [{ words: words.join(',') }] } : {}),
  };
}

// CLOVA HTTP failures when a job is started, as codes the screen explains (no upstream bodies are forwarded).
export function clovaStartError(status) {
  if (status === 401 || status === 403) return { status: 503, error: 'stt_key_invalid' };
  if (status === 429) return { status: 429, error: 'stt_busy' };
  if (status === 400 || status === 413 || status === 415) return { status: 400, error: 'stt_rejected' };
  return { status: 502, error: 'stt_upstream_error' };
}

const label = (value) => String(value ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 8);

// CLOVA result (callback body) → what is stored: [{ s, e, sp, text, c }] in ms, speaker labels, or a failure code.
export function clovaResult(payload) {
  if (!plainObject(payload)) return { status: 'failed', error: 'stt_bad_result' };
  const result = String(payload.result || '').toUpperCase();
  if (result && result !== 'COMPLETED' && result !== 'SUCCEEDED') return { status: 'failed', error: result === 'FAILED' ? 'stt_failed' : 'stt_bad_result' };
  const segments = [];
  for (const segment of Array.isArray(payload.segments) ? payload.segments : []) {
    if (segments.length >= AUDIO_LIMITS.segments) break;
    if (!plainObject(segment)) continue;
    const text = String(segment.textEdited || segment.text || '').replace(/\s+/g, ' ').trim().slice(0, AUDIO_LIMITS.segmentChars);
    if (!text) continue;
    const s = Math.max(0, Math.round(Number(segment.start) || 0));
    const e = Math.max(s, Math.round(Number(segment.end) || s));
    const sp = label(segment.speaker?.label ?? segment.diarization?.label) || '1';
    const c = Number(segment.confidence);
    segments.push(Number.isFinite(c) ? { s, e, sp, text, c: Math.round(c * 100) / 100 } : { s, e, sp, text });
  }
  segments.sort((a, b) => a.s - b.s);
  const speakers = [...new Set(segments.map((segment) => segment.sp))];
  return { status: 'done', segments, speakers };
}

// One recording as the screen sees it: no storage path, job token or callback secret.
export function recordingItem(row) {
  return {
    recordingId: row.id,
    audioKey: row.audio_key,
    status: row.status,
    bytes: Number(row.bytes) || 0,
    duration: Number(row.duration_sec) || 0,
    speakers: row.speakers ?? null,
    errorCode: row.error_code || null,
    requestedAt: row.requested_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  };
}

export function transcribeRateLimited(requestsInLastHour) {
  return !Number.isInteger(requestsInLastHour) || requestsInLastHour >= AUDIO_LIMITS.transcribePerHour;
}

// A job still 'processing' long after it was requested may be started again (the old callback secret is replaced).
export function processingIsStale(requestedAt, now = Date.now()) {
  const at = Date.parse(String(requestedAt || ''));
  return !Number.isFinite(at) || now - at > AUDIO_LIMITS.staleProcessingMs;
}

// Single-use callback secret: 32 random bytes as hex; only its SHA-256 is stored.
export function newCallbackSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function secretHash(secret) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison of two hex digests.
export function sameDigest(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!/^[0-9a-f]{64}$/.test(x) || !/^[0-9a-f]{64}$/.test(y)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
