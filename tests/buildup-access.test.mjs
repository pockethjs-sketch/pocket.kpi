import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILDUP_LIMITS, BUILDUP_AI_MODELS, canUseBuildup, isBuildupAdmin, canReadBuildupOwner, canWriteBuildupOwner,
  validateSave, decideSave, validateAi, aiRateLimited, aiUpstreamError, createUsageTap, memberName, listItem, usageRows, cleanSummary,
} from '../supabase/functions/_shared/buildup-access.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const access = (role, extra = {}) => ({ ok: true, userId: OWNER, organizationId: 'test-org', role, scope: 'all', ...extra });
const edge = readFileSync(new URL('../supabase/functions/kpi-buildup-api/index.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

test('every active employee keeps their own consultations; only OWNER/ADMIN read others', () => {
  for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']) {
    assert.equal(canUseBuildup(access(role)), true);
    assert.equal(canWriteBuildupOwner(access(role), OWNER), true);
    assert.equal(canWriteBuildupOwner(access(role), OTHER), false, `${role} must never write another employee's consultation`);
  }
  assert.equal(canReadBuildupOwner(access('EDITOR'), OTHER), false);
  assert.equal(canReadBuildupOwner(access('VIEWER'), OTHER), false);
  assert.equal(canReadBuildupOwner(access('OWNER'), OTHER), true);
  assert.equal(canReadBuildupOwner(access('ADMIN'), OTHER), true);
  assert.equal(isBuildupAdmin(access('EDITOR')), false);
  assert.equal(canReadBuildupOwner(access('OWNER'), 'not-a-uuid'), false);
});

test('rejected sessions, unknown roles and restricted scopes cannot use the workspace', () => {
  assert.equal(canUseBuildup({ ok: false, status: 401 }), false);
  assert.equal(canUseBuildup(access('SERVICE')), false);
  assert.equal(canUseBuildup(access('VIEWER', { scope: 'premeeting' })), false);
});

test('save payloads are validated, bounded and summaries reduced to display fields', () => {
  const core = { id: 'p1', company: { name: '테스트상사' } };
  const ok = validateSave({ id: 'p1', core, summary: { id: 'p1', name: '테스트상사', password: 'x', deal: { stage: 'open' } }, heavy: null, baseRevision: 0 });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.value.summary).sort(), ['deal', 'id', 'name']);
  assert.equal(ok.value.heavy, null);
  for (const bad of [
    { id: '../x', core: { id: '../x' }, summary: {} },
    { id: 'p1', core: { id: 'p2' }, summary: {} },
    { id: 'p1', core, summary: [] },
    { id: 'p1', core, summary: {}, heavy: [] },
    { id: 'p1', core, summary: {}, baseRevision: -1 },
    { id: 'p1', core, summary: {}, force: 'yes' },
  ]) assert.equal(validateSave(bad).ok, false);
  const huge = validateSave({ id: 'p1', core, summary: {}, heavy: { transcript: 'x'.repeat(BUILDUP_LIMITS.heavyBytes + 1) } });
  assert.deepEqual([huge.status, huge.error], [413, 'payload_too_large']);
  assert.equal(cleanSummary({ name: 'a'.repeat(400) }).name.length, 300);
});

test('optimistic revisions stop silent overwrites from a second window', () => {
  assert.deepEqual(decideSave(null, { baseRevision: 0 }), { action: 'insert', nextRevision: 1 });
  assert.deepEqual(decideSave({ revision: 3 }, { baseRevision: 3 }), { action: 'update', nextRevision: 4 });
  assert.deepEqual(decideSave({ revision: 4 }, { baseRevision: 3 }), { error: 'conflict', status: 409, revision: 4 });
  assert.deepEqual(decideSave({ revision: 4 }, { baseRevision: 3, force: true }), { action: 'update', nextRevision: 5 });
  assert.deepEqual(decideSave({ revision: 6, deleted_at: '2026-10-20' }, { baseRevision: 5 }), { error: 'deleted', status: 409, revision: 6 });
  assert.deepEqual(decideSave({ revision: 6, deleted_at: '2026-10-20' }, { baseRevision: 0 }), { action: 'revive', nextRevision: 7 });
});

test('AI requests are limited to approved models, text messages and bounded size', () => {
  const base = { model: 'claude-opus-5-5', max_tokens: 1200, messages: [{ role: 'user', content: '정리해 주세요' }], stream: true };
  const ok = validateAi({ ...base, system: '지침', tools: [{ name: 'x' }], metadata: { user_id: 'x' } });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.value).sort(), ['max_tokens', 'messages', 'model', 'stream', 'system']);
  assert.deepEqual(BUILDUP_AI_MODELS, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.equal(validateAi({ ...base, model: 'claude-other' }).error, 'model_not_allowed');
  assert.equal(validateAi({ ...base, max_tokens: BUILDUP_LIMITS.aiMaxTokens + 1 }).ok, false);
  assert.equal(validateAi({ ...base, messages: [{ role: 'system', content: 'x' }] }).ok, false);
  assert.equal(validateAi({ ...base, messages: [{ role: 'user', content: [{ type: 'image' }] }] }).ok, false);
  assert.equal(validateAi({ ...base, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }).ok, false);
  assert.equal(validateAi({ ...base, messages: [{ role: 'user', content: 'x'.repeat(BUILDUP_LIMITS.aiInputBytes) }] }).error, 'payload_too_large');
  assert.equal(aiRateLimited(BUILDUP_LIMITS.aiCallsPerHour - 1), false);
  assert.equal(aiRateLimited(BUILDUP_LIMITS.aiCallsPerHour), true);
  assert.equal(aiRateLimited(null), true);
  assert.deepEqual(aiUpstreamError(401), { status: 503, error: 'ai_key_invalid' });
  assert.deepEqual(aiUpstreamError(529), { status: 502, error: 'upstream_error' });
});

test('usage tap reads token counts from the event stream without altering it', () => {
  const tap = createUsageTap();
  tap.push('event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":120}}}\n\n');
  tap.push('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4');
  tap.push('5}}\n\n');
  assert.deepEqual(tap.finish(), { model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 45, stopReason: 'end_turn' });
});

test('list rows expose owner names to admins without email addresses', () => {
  assert.equal(memberName({ display_name: 'kim.sales@example.invalid' }), 'kim.sales');
  assert.equal(memberName({ display_name: '  김영업  ' }), '김영업');
  assert.equal(memberName(null), '직원');
  const row = { project_id: 'p1', owner_user_id: OTHER, revision: 2, updated_at: '2026-10-20T00:00:00Z', summary: { name: '테스트상사' }, core: { secret: 1 } };
  const item = listItem(row, new Map([[OTHER, '김영업']]));
  assert.deepEqual(item, { id: 'p1', ownerId: OTHER, ownerName: '김영업', revision: 2, updatedAt: '2026-10-20T00:00:00Z', summary: { name: '테스트상사' } });
  assert.deepEqual(usageRows([{ user_id: OTHER, input_tokens: 10, output_tokens: 5, created_at: '2026-10-19' }, { user_id: OTHER, input_tokens: null, output_tokens: 2, created_at: '2026-10-20' }]),
    [{ userId: OTHER, calls: 2, inputTokens: 10, outputTokens: 7, lastAt: '2026-10-20' }]);
});

test('edge function authenticates every request and never returns the company key', () => {
  assert.match(config, /\[functions\.kpi-buildup-api\]\s*\nverify_jwt = true/);
  assert.match(edge, /authorizeEmployee\(/);
  assert.match(edge, /canUseBuildup\(access\)/);
  assert.ok(edge.indexOf('authorizeEmployee(') < edge.indexOf('req.text()'), 'body is read only after authorization');
  assert.match(edge, /canReadBuildupOwner\(access, ownerId\)/);
  assert.match(edge, /eq\("owner_user_id", me\)[\s\S]*eq\("project_id", value\.id\)/);
  assert.match(edge, /scope === "all"[\s\S]{0,80}isBuildupAdmin/);
  assert.match(edge, /Deno\.env\.get\("ANTHROPIC_API_KEY"\)/);
  assert.doesNotMatch(edge, /reply\([^)]*\bkey\b/, 'company key must never be part of a response');
  assert.match(edge, /aiRateLimited\(count\)/);
  assert.doesNotMatch(edge, /access-control-allow-origin": "\*"/);
  assert.doesNotMatch(edge, /console\.(log|info|debug)/);
});
