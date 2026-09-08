import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const code = await readFile(new URL("../../pocket-kpi-deploy/Code.gs", import.meta.url), "utf8");
const frontend = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("Apps Script commits Supabase primary before the Sheets backup", () => {
  const primary = code.indexOf("_crmCommitSupabasePrimary_(mutationId, current.revision, revision");
  const sheets = code.indexOf("_crmWriteBufferedState(nextText, revision)");
  assert.ok(primary >= 0 && sheets > primary);
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

test("state reads Supabase primary and falls back only when it is unavailable", () => {
  assert.match(code, /shadowState && shadowState\.revision && shadowState\.snapshot/);
  assert.match(code, /readBackend = 'supabase'/);
  assert.match(code, /if \(!stateOnly\) stateOnly = _crmReadStateEnvelope\(\)/);
});

test("failed Sheets backup does not roll back a committed Supabase write", () => {
  assert.match(code, /sheetsBackup = \{ ok: false, pending: true/);
  assert.match(code, /_crmBackupSupabasePrimaryToSheets_/);
});

test("periodic reconciliation runs even when the local retry queue is empty", () => {
  const retryStart = code.indexOf("function retrySupabaseShadowQueue()");
  const retryEnd = code.indexOf("function installSupabaseShadowRetryTrigger", retryStart);
  const retryBody = code.slice(retryStart, retryEnd);
  assert.doesNotMatch(retryBody, /getLastRow\(\) < 2\) return/);
  assert.match(retryBody, /_crmBackupSupabasePrimaryToSheets_\(\)/);
});

test("state route does not read unused Sheets metadata before Supabase", () => {
  const stateStart = code.indexOf("if (action === 'state')");
  const stateEnd = code.indexOf("var marketing =", stateStart);
  assert.doesNotMatch(code.slice(stateStart, stateEnd), /_crmReadMeta\(\)/);
});

test("public frontend does not embed a CRM bearer token", () => {
  assert.match(frontend, /var CRM_JWT = '';/);
  assert.doesNotMatch(frontend, /var CRM_JWT = ['"]eyJ/);
  assert.match(frontend, /const syncProxy = await window\.crmFetchRefreshPayload/);
});
