// Bridge between the KPI workspace (employee session holder) and the isolated buildup frame.
// The frame runs in an opaque-origin sandbox without network, storage or microphone access.
// It talks only through a private MessagePort created here; the employee session token,
// Supabase client and KPI state never cross into the frame. Only validated operations
// are forwarded to the kpi-buildup-api Edge Function, and only results come back.

export const BUILDUP_BRIDGE_VERSION = 1;

export const BUILDUP_BRIDGE_LIMITS = Object.freeze({
  saveBytes: 7_000_000,
  aiBytes: 1_000_000,
  prefsBytes: 64_000,
  deltaIntervalMs: 120,
});

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_OPS = new Set(['session', 'list', 'get', 'save', 'delete', 'usage']);
const ERROR_FIELDS = ['revision', 'name', 'detail', 'perm', 'message'];

const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const sizeOf = (value) => { try { return JSON.stringify(value ?? null).length; } catch { return Infinity; } };
const bool = (value) => value === undefined || typeof value === 'boolean';

const RULES = {
  session: () => true,
  list: (a) => a.scope === undefined || a.scope === 'mine' || a.scope === 'all',
  get: (a) => ID.test(String(a.id || '')) && (a.ownerId === undefined || UUID.test(String(a.ownerId))),
  save: (a) => ID.test(String(a.id || '')) && plainObject(a.core) && a.core.id === a.id && plainObject(a.summary)
    && (a.heavy === null || a.heavy === undefined || plainObject(a.heavy))
    && Number.isInteger(a.baseRevision ?? 0) && (a.baseRevision ?? 0) >= 0 && bool(a.force)
    && sizeOf(a) <= BUILDUP_BRIDGE_LIMITS.saveBytes,
  delete: (a) => ID.test(String(a.id || '')),
  usage: (a) => a.days === undefined || (Number.isInteger(a.days) && a.days >= 1 && a.days <= 90),
  ai: (a) => typeof a.model === 'string' && a.model.length <= 80 && Number.isInteger(a.max_tokens) && a.max_tokens >= 1
    && Array.isArray(a.messages) && a.messages.length >= 1 && a.messages.length <= 200
    && a.messages.every((m) => plainObject(m) && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    && (a.system === undefined || typeof a.system === 'string') && bool(a.stream)
    && sizeOf(a) <= BUILDUP_BRIDGE_LIMITS.aiBytes,
  abort: (a) => REQUEST_ID.test(String(a.target || '')),
  'prefs.get': () => true,
  'prefs.set': (a) => plainObject(a.prefs) && sizeOf(a.prefs) <= BUILDUP_BRIDGE_LIMITS.prefsBytes,
  'rec.start': (a) => (a.base === undefined || (Number.isFinite(a.base) && a.base >= 0)) && bool(a.sr),
  'rec.pause': () => true,
  'rec.resume': () => true,
  'rec.stop': () => true,
  'rec.sr': (a) => typeof a.on === 'boolean',
  'ui.state': (a) => bool(a.pending) && bool(a.recording),
};

export const BUILDUP_BRIDGE_OPS = Object.freeze(Object.keys(RULES));

// Returns { id, op, args } for an allowed, well-formed message, otherwise null (silently dropped).
export function validateBridgeMessage(data) {
  if (!plainObject(data) || typeof data.op !== 'string' || !RULES[data.op]) return null;
  if (data.id !== undefined && !REQUEST_ID.test(String(data.id))) return null;
  const args = data.args === undefined ? {} : data.args;
  if (!plainObject(args)) return null;
  try { if (!RULES[data.op](args)) return null; } catch { return null; }
  return { id: data.id, op: data.op, args };
}

// Only short error codes and a few diagnostic fields reach the frame (no stack traces or payloads).
export function bridgeError(error) {
  const raw = String(error?.code || error?.message || 'bridge_error');
  const out = { code: /^[a-z0-9_]{1,60}$/.test(raw) ? raw : 'bridge_error' };
  for (const field of ERROR_FIELDS) {
    if (field === 'name' && error instanceof Error) continue; // only DOMException-style names help diagnosis
    const value = error?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
    else if (typeof value === 'string' && value) out[field] = value.slice(0, 200);
  }
  return out;
}

export function createBuildupBridge({ post, call, aiStream, recorder, prefs, onUiState, now = () => Date.now() }) {
  const running = new Map();
  let closed = false;
  const send = (message, transfer) => { if (!closed) post(message, transfer || []); };
  const answer = (id, data) => { if (id !== undefined) send({ id, ok: true, data: data ?? {} }); };
  const refuse = (id, error) => { if (id !== undefined) send({ id, ok: false, error: bridgeError(error) }); };

  function deltas(id) {
    let last = 0, pending = null, timer = null;
    const flush = () => { timer = null; if (pending !== null) { send({ id, ev: 'delta', text: pending }); pending = null; last = now(); } };
    return {
      push(text) {
        pending = text;
        const wait = BUILDUP_BRIDGE_LIMITS.deltaIntervalMs - (now() - last);
        if (wait <= 0) flush(); else if (!timer) timer = setTimeout(flush, wait);
      },
      done() { if (timer) clearTimeout(timer); timer = null; pending = null; },
    };
  }

  async function run(id, op, args) {
    if (SERVER_OPS.has(op)) {
      const controller = new AbortController();
      if (id !== undefined) running.set(id, controller);
      try {
        const result = await call(op, args, controller.signal);
        const { ok, ...data } = result || {};
        answer(id, data);
      } catch (error) { refuse(id, error); }
      finally { running.delete(id); }
      return;
    }
    if (op === 'ai') {
      const controller = new AbortController();
      if (id !== undefined) running.set(id, controller);
      const stream = deltas(id);
      try {
        const result = await aiStream(args, controller.signal, (text) => stream.push(text));
        stream.done();
        answer(id, { text: String(result?.text || ''), model: String(result?.model || ''), truncated: !!result?.truncated });
      } catch (error) { stream.done(); refuse(id, error); }
      finally { running.delete(id); }
      return;
    }
    if (op === 'abort') { running.get(args.target)?.abort(); return; }
    if (op === 'prefs.get') { answer(id, { prefs: prefs?.get() || {} }); return; }
    if (op === 'prefs.set') { prefs?.set(args.prefs); answer(id); return; }
    if (op === 'ui.state') { onUiState?.({ pending: !!args.pending, recording: !!args.recording }); return; }
    if (op === 'rec.start') {
      try { await recorder.start({ base: args.base || 0, sr: !!args.sr }); answer(id); } catch (error) { refuse(id, error); }
      return;
    }
    if (op === 'rec.pause') recorder.pause();
    else if (op === 'rec.resume') recorder.resume();
    else if (op === 'rec.stop') recorder.stop();
    else if (op === 'rec.sr') recorder.setSr(args.on);
    answer(id);
  }

  return {
    handle(data) {
      if (closed) return false;
      const message = validateBridgeMessage(data);
      if (!message) return false;
      run(message.id, message.op, message.args);
      return true;
    },
    // Recorder events: transcript lines, interim text, errors and the finished recording.
    recorderEvent(event) {
      if (!event || typeof event.type !== 'string') return;
      if (event.type === 'result' && event.buffer instanceof ArrayBuffer) {
        send({ ev: 'rec', type: 'result', buffer: event.buffer, mime: String(event.mime || ''), duration: Number(event.duration) || 0 }, [event.buffer]);
        return;
      }
      if (event.type === 'line') send({ ev: 'rec', type: 'line', text: String(event.text || ''), t: Number(event.t) || 0 });
      else if (event.type === 'interim') send({ ev: 'rec', type: 'interim', text: String(event.text || '') });
      else if (event.type === 'error') send({ ev: 'rec', type: 'error', message: String(event.message || ''), ...(event.srOn === false ? { srOn: false } : {}) });
      else if (event.type === 'result') send({ ev: 'rec', type: 'result', mime: String(event.mime || ''), duration: Number(event.duration) || 0 });
    },
    close() {
      closed = true;
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
  };
}
