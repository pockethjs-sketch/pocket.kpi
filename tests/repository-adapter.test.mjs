import test from "node:test";
import assert from "node:assert/strict";
import { createShadowRepository, compareRepositorySnapshots, readRepositoryConfig } from "../src/data/repositoryAdapter.js";

test("Sheets is the fail-safe default", () => {
  assert.equal(readRepositoryConfig({}).mode, "sheets");
  assert.equal(readRepositoryConfig({ VITE_KPI_DATA_BACKEND: "invalid" }).mode, "sheets");
});

test("shadow writes preserve the V3 mutation id after primary commit", async () => {
  let body;
  const repo = createShadowRepository({ config: { mode: "shadow-write", shadowUrl: "https://example.test", publishableKey: "pk" }, fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true }) }; } });
  await repo.afterPrimaryCommit({ mutationId: "web-1", mutation: { schemaVersion: 3, collections: {} }, revision: "r2" });
  assert.equal(body.mutationId, "web-1"); assert.equal(body.primaryRevision, "r2"); assert.equal(body.mutation.schemaVersion, 3);
});

test("read compare reports only differing business domains", () => {
  const result = compareRepositorySnapshots({ deals: [{ id: 1 }], payments: [{ id: 2 }] }, { deals: [{ id: 1 }], payments: [] });
  assert.deepEqual(result, { equal: false, differences: ["payments"] });
});

test("shadow failure cannot change the primary commit result", async () => {
  const repo = createShadowRepository({ config: { mode: "shadow-write", shadowUrl: "https://example.test", publishableKey: "pk" }, fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(repo.afterPrimaryCommit({ mutationId: "same-id", mutation: { schemaVersion: 3 }, revision: "r3" }), /shadow_http_503/);
});
