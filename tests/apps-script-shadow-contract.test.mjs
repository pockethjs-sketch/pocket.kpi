import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const code = await readFile(new URL("../../pocket-kpi-deploy/Code.gs", import.meta.url), "utf8");

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
