import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const code = await readFile(new URL("../../pocket-kpi-deploy/Code.gs", import.meta.url), "utf8");

test("Apps Script sends shadow only after Sheets COMMIT", () => {
  const commit = code.indexOf("_crmAppendChangeLog(revision, mutationId, actor, [], 'COMMIT')");
  const enqueue = code.indexOf("_crmEnqueueSupabaseShadow_(mutationId, revision");
  assert.ok(commit >= 0 && enqueue > commit);
});

test("shadow credentials come only from Script Properties", () => {
  assert.match(code, /getProperty\('KPI_SHADOW_GATEWAY_URL'\)/);
  assert.match(code, /getProperty\('KPI_SHADOW_HMAC_SECRET'\)/);
  assert.doesNotMatch(code, /KPI_SHADOW_HMAC_SECRET\s*=\s*['"][^'"]+['"]/);
});

test("shadow failure is queued without throwing into primary save", () => {
  assert.match(code, /_crmQueueShadowFailure_/);
  assert.match(code, /pendingRetry: true/);
  assert.match(code, /retrySupabaseShadowQueue/);
});

test("state reads Supabase only at the current Sheets revision and otherwise falls back", () => {
  assert.match(code, /String\(shadowState\.revision\) === String\(stateMeta\.revision \|\| ''\)/);
  assert.match(code, /readBackend = 'supabase'/);
  assert.match(code, /if \(!stateOnly\) stateOnly = _crmReadStateEnvelope\(\)/);
});
