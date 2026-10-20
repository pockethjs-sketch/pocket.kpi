// Buildup consultation workspace rules (kpi-buildup-api).
// Every active employee keeps their own consultations; OWNER/ADMIN may read everyone's.
// Nobody edits or deletes another employee's consultation. The company AI key never leaves the server.
// Pure helpers only: the Edge Function performs authentication (authorizeEmployee) before using these.

export const BUILDUP_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BUILDUP_LIMITS = Object.freeze({
  bodyBytes: 7_000_000,
  coreBytes: 400_000,
  summaryBytes: 16_000,
  heavyBytes: 6_000_000,
  aiInputBytes: 1_000_000,
  aiMaxTokens: 32_000,
  aiMessages: 200,
  aiCallsPerHour: 240,
  premeetingRows: 500,
  listRows: 2_000,
  usageDays: 90,
});

export const BUILDUP_AI_MODELS = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);

const SUMMARY_KEYS = ['id', 'name', 'ceo', 'date', 'time', 'status', 'tier', 'total', 'updatedAt', 'saveId', 'tm', 'bm1', 'deal', 'recSec', 'trN', 'final', 'crm'];
const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

export function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return new TextEncoder().encode(text).length;
}

export function canUseBuildup(access) {
  return !!access?.ok && ROLES.includes(access.role) && (access.scope || 'all') === 'all';
}

export function isBuildupAdmin(access) {
  return canUseBuildup(access) && ['OWNER', 'ADMIN'].includes(access.role);
}

export function canReadBuildupOwner(access, ownerId) {
  return canUseBuildup(access) && UUID.test(String(ownerId || '')) && (ownerId === access.userId || isBuildupAdmin(access));
}

export function canWriteBuildupOwner(access, ownerId) {
  return canUseBuildup(access) && ownerId === access.userId;
}

// The browser-computed list summary is display data only. Keep known keys and bounded strings.
export function cleanSummary(summary) {
  const out = {};
  for (const key of SUMMARY_KEYS) {
    const value = summary?.[key];
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 300);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' || value === null) out[key] = value;
    else if (plainObject(value)) out[key] = JSON.parse(JSON.stringify(value));
  }
  return out;
}

export function validateSave(body) {
  const id = String(body?.id || '');
  if (!BUILDUP_ID.test(id)) return fail(400, 'invalid_project');
  const { core, summary } = body;
  const heavy = body.heavy === undefined ? null : body.heavy;
  if (!plainObject(core) || core.id !== id || !plainObject(summary)) return fail(400, 'invalid_project');
  if (heavy !== null && !plainObject(heavy)) return fail(400, 'invalid_project');
  const baseRevision = body.baseRevision ?? 0;
  if (!Number.isInteger(baseRevision) || baseRevision < 0) return fail(400, 'invalid_project');
  if (body.force !== undefined && typeof body.force !== 'boolean') return fail(400, 'invalid_project');
  if (byteLength(core) > BUILDUP_LIMITS.coreBytes || byteLength(summary) > BUILDUP_LIMITS.summaryBytes) return fail(413, 'payload_too_large');
  if (heavy !== null && byteLength(heavy) > BUILDUP_LIMITS.heavyBytes) return fail(413, 'payload_too_large');
  return { ok: true, value: { id, core, summary: cleanSummary(summary), heavy, baseRevision, force: body.force === true } };
}

// Optimistic concurrency: the same employee may have the consultation open in two windows.
export function decideSave(existing, value) {
  if (!existing) return { action: 'insert', nextRevision: 1 };
  const current = Number(existing.revision) || 0;
  if (existing.deleted_at) {
    if (value.force || value.baseRevision === 0) return { action: 'revive', nextRevision: current + 1 };
    return { error: 'deleted', status: 409, revision: current };
  }
  if (!value.force && current !== value.baseRevision) return { error: 'conflict', status: 409, revision: current };
  return { action: 'update', nextRevision: current + 1 };
}

export function validateAi(body) {
  const model = String(body?.model || '');
  if (!BUILDUP_AI_MODELS.includes(model)) return fail(400, 'model_not_allowed');
  const maxTokens = body.max_tokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > BUILDUP_LIMITS.aiMaxTokens) return fail(400, 'invalid_ai_request');
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > BUILDUP_LIMITS.aiMessages) return fail(400, 'invalid_ai_request');
  for (const message of messages) {
    if (!plainObject(message) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content) return fail(400, 'invalid_ai_request');
  }
  if (messages[messages.length - 1].role !== 'user') return fail(400, 'invalid_ai_request');
  if (body.system !== undefined && typeof body.system !== 'string') return fail(400, 'invalid_ai_request');
  const value = { model, max_tokens: maxTokens, messages: messages.map(({ role, content }) => ({ role, content })), stream: body.stream === true };
  if (body.system) value.system = body.system;
  if (byteLength(value) > BUILDUP_LIMITS.aiInputBytes) return fail(413, 'payload_too_large');
  return { ok: true, value };
}

export function aiRateLimited(callsInLastHour) {
  return !Number.isInteger(callsInLastHour) || callsInLastHour >= BUILDUP_LIMITS.aiCallsPerHour;
}

// Anthropic HTTP failures mapped to codes the consultation screen explains. Never forwards credentials.
export function aiUpstreamError(status) {
  if (status === 401 || status === 403) return { status: 503, error: 'ai_key_invalid' };
  if (status === 429) return { status: 429, error: 'rate_limited' };
  if (status === 404) return { status: 400, error: 'model' };
  if (status === 413) return { status: 413, error: 'payload_too_large' };
  if (status === 400) return { status: 400, error: 'invalid_ai_request' };
  return { status: 502, error: 'upstream_error' };
}

// Reads token usage from the Anthropic event stream while bytes pass through untouched.
export function createUsageTap() {
  let buffer = '';
  const usage = { model: '', inputTokens: null, outputTokens: null, stopReason: '' };
  const read = (line) => {
    if (!line.startsWith('data:')) return;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { return; }
    if (event?.type === 'message_start') {
      usage.model = String(event.message?.model || usage.model);
      const input = event.message?.usage?.input_tokens;
      if (Number.isInteger(input)) usage.inputTokens = input;
    } else if (event?.type === 'message_delta') {
      const output = event.usage?.output_tokens;
      if (Number.isInteger(output)) usage.outputTokens = output;
      if (event.delta?.stop_reason) usage.stopReason = String(event.delta.stop_reason);
    }
  };
  return {
    push(text) {
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { read(buffer.slice(0, index).trim()); buffer = buffer.slice(index + 1); }
    },
    finish() { if (buffer.trim()) read(buffer.trim()); buffer = ''; return { ...usage }; },
  };
}

export function memberName(profile) {
  const raw = String(profile?.display_name || '').trim();
  const name = raw.includes('@') ? raw.split('@')[0] : raw;
  return name.slice(0, 40) || '직원';
}

export function listItem(row, names) {
  return {
    id: row.project_id,
    ownerId: row.owner_user_id,
    ownerName: names?.get(row.owner_user_id) || '',
    revision: row.revision,
    updatedAt: row.updated_at,
    summary: plainObject(row.summary) ? row.summary : {},
  };
}

export function usageRows(rows) {
  const byUser = new Map();
  for (const row of rows || []) {
    const item = byUser.get(row.user_id) || { userId: row.user_id, calls: 0, inputTokens: 0, outputTokens: 0, lastAt: '' };
    item.calls += 1;
    item.inputTokens += Number(row.input_tokens) || 0;
    item.outputTokens += Number(row.output_tokens) || 0;
    if (String(row.created_at || '') > item.lastAt) item.lastAt = String(row.created_at);
    byUser.set(row.user_id, item);
  }
  return [...byUser.values()].sort((a, b) => b.calls - a.calls);
}
