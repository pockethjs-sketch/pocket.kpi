import test from "node:test";
import assert from "node:assert/strict";
import { compareRepositorySnapshots, readRepositoryConfig, shadowStatusFromSheetsResult } from "../src/data/repositoryAdapter.js";

test("Sheets is the fail-safe default", () => {
  assert.equal(readRepositoryConfig({}).mode, "sheets");
  assert.equal(readRepositoryConfig({ VITE_KPI_DATA_BACKEND: "invalid" }).mode, "sheets");
});

test("frontend consumes Apps Script shadow status without direct database writes", () => {
  assert.deepEqual(shadowStatusFromSheetsResult({ shadow: { configured: true, queued: true } }), { configured: true, state: "queued", duplicate: false });
  assert.deepEqual(shadowStatusFromSheetsResult({ shadow: { configured: true, pendingRetry: true, error: "timeout" } }), { configured: true, state: "pending-retry", error: "timeout" });
});

test("frontend reports the Supabase-primary save and Sheets backup separately", () => {
  assert.deepEqual(shadowStatusFromSheetsResult({ primary: "supabase", sheetsBackup: { ok: true, pending: false } }), {
    configured: true,
    state: "committed-and-backed-up",
    primary: "supabase",
    backupPending: false,
    error: undefined,
  });
  assert.deepEqual(shadowStatusFromSheetsResult({ primary: "supabase", sheetsBackup: { ok: false, pending: true, error: "sheet_timeout" } }), {
    configured: true,
    state: "committed-backup-pending",
    primary: "supabase",
    backupPending: true,
    error: "sheet_timeout",
  });
});

test("read compare reports only differing business domains", () => {
  const result = compareRepositorySnapshots({ deals: [{ id: 1 }], payments: [{ id: 2 }] }, { deals: [{ id: 1 }], payments: [] });
  assert.deepEqual(result, { equal: false, differences: ["payments"] });
});

test("missing server configuration is explicitly disabled", () => {
  assert.deepEqual(shadowStatusFromSheetsResult({ shadow: { configured: false } }), { configured: false, state: "disabled" });
});
