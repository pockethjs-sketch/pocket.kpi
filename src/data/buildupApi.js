import { SUPABASE_URL, employeeHeaders } from '../employeeSession.js';

// Calls the kpi-buildup-api Edge Function with the current employee session.
// The session token is attached here, in the KPI page, and never handed to the buildup frame.
const ENDPOINT = `${SUPABASE_URL}/functions/v1/kpi-buildup-api`;

function codeError(code, extra) {
  const error = new Error(code);
  error.code = code;
  if (typeof extra?.revision === 'number') error.revision = extra.revision;
  if (typeof extra?.message === 'string' && extra.message) error.message = extra.message;
  return error;
}

async function post(body, signal) {
  let headers;
  try { headers = await employeeHeaders(); } catch { throw codeError('login_required'); }
  try {
    return await fetch(ENDPOINT, {
      method: 'POST', cache: 'no-store', signal,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw codeError(error?.name === 'AbortError' ? 'cancelled' : 'network');
  }
}

async function failure(response) {
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (response.status === 404 && !result?.error) return codeError('not_deployed');
  return codeError(result?.error || `http_${response.status}`, result);
}

export async function buildupCall(action, args, signal) {
  const response = await post({ ...args, action }, signal);
  if (!response.ok) throw await failure(response);
  let result;
  try { result = await response.json(); } catch { throw codeError('bad_response'); }
  if (!result || result.error) throw codeError(result?.error || 'bad_response', result);
  return result;
}

// Streams an Anthropic Messages response proxied by the Edge Function (server-held company key).
export async function buildupAiStream(args, signal, onText) {
  const response = await post({ ...args, action: 'ai' }, signal);
  if (!response.ok) throw await failure(response);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('event-stream')) {
    const result = await response.json();
    if (!result || result.error) throw codeError(result?.error || 'bad_response', result);
    if (result.text) onText(result.text);
    return { text: String(result.text || ''), model: String(result.model || args.model), truncated: !!result.truncated };
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', model = args.model, truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const line = chunk.split('\n').find((part) => part.startsWith('data:'));
        if (!line) continue;
        let event;
        try { event = JSON.parse(line.slice(5)); } catch { continue; }
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') { text += event.delta.text; onText(text); }
        else if (event.type === 'message_start' && event.message?.model) model = event.message.model;
        else if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') truncated = true;
        else if (event.type === 'error') throw codeError('upstream_error', { message: String(event.error?.message || '') });
      }
    }
  } catch (error) {
    if (error?.code) throw error;
    throw codeError(error?.name === 'AbortError' ? 'cancelled' : 'network');
  }
  return { text, model, truncated };
}

// Per-employee screen preferences (panel layout, theme, last consultation) in this browser.
const PREFS_KEY = 'buildup:prefs:v1';
export const buildupPrefs = {
  get() {
    try { return JSON.parse(window.kpiEmployeeStorage?.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
  },
  set(value) {
    try { window.kpiEmployeeStorage?.setItem(PREFS_KEY, JSON.stringify(value || {})); } catch { /* storage full or blocked */ }
  },
};
