import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExport, reconcileExport } from "../scripts/migration-lib.mjs";

test("contract, quote, planned, received, and outstanding amounts remain distinct", () => {
  const data = normalizeExport({ revision: "r1", deals: [{ rowKey: "d1", quotedAmount: 1200, contractAmount: 1000 }], payments: [{ rowKey: "p1", plannedAmount: 600, receivedAmount: 400 }] });
  const result = reconcileExport(data);
  assert.deepEqual(result.totals, { quotedAmount: 1200, contractAmount: 1000, plannedAmount: 600, receivedAmount: 400, outstandingAmount: 600, marketingSpend: 0 });
});

test("duplicate source keys block a rerun before remote writes", () => {
  const data = normalizeExport({ leads: [{ rowKey: "7" }, { rowKey: "7" }] });
  assert.equal(reconcileExport(data).duplicates.length, 1);
});

test("provider totals reconcile without inventing campaign splits", () => {
  const data = normalizeExport({ marketingDaily: [{ rowKey: "m1", provider: "META", spendAmount: 300 }, { rowKey: "g1", provider: "GOOGLE_ADS", spendAmount: 20 }] });
  assert.equal(reconcileExport(data).totals.marketingSpend, 320);
});

