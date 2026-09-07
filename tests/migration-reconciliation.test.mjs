import test from "node:test";
import assert from "node:assert/strict";
import { exportV3State, normalizeExport, reconcileExport } from "../scripts/migration-lib.mjs";

test("contract, quote, planned, received, and outstanding amounts remain distinct", () => {
  const data = normalizeExport({ revision: "r1", accounts: [], deals: [{ rowKey: "d1", quotedAmount: 1200, contractAmount: 1000 }], payments: [{ rowKey: "p1", dealRowKey: "d1", plannedAmount: 600, receivedAmount: 400 }] });
  const result = reconcileExport(data);
  assert.deepEqual(result.totals, { quotedAmount: 1200, contractAmount: 1000, plannedAmount: 600, receivedAmount: 400, outstandingAmount: 600, marketingSpend: 0 });
});

test("duplicate source keys block a rerun before remote writes", () => {
  const data = normalizeExport({ accounts: [], leads: [{ rowKey: "7" }, { rowKey: "7" }] });
  assert.equal(reconcileExport(data).duplicates.length, 1);
});

test("provider totals reconcile without inventing campaign splits", () => {
  const data = normalizeExport({ marketingDaily: [{ rowKey: "m1", provider: "META", spendAmount: 300 }, { rowKey: "g1", provider: "GOOGLE_ADS", spendAmount: 20 }] });
  assert.equal(reconcileExport(data).totals.marketingSpend, 320);
});

test("V3 paid total is not added twice when confirmed payments already match", () => {
  const data = exportV3State({ leads: [{ id: "L1", status: "계약 완료", contractAmount: 1000, paid: 400, payments: [{ id: "P1", amount: 400, paidConfirmed: true, paidAt: "2026-09-01" }] }], adDaily: {} }, "r1");
  const result = reconcileExport(data);
  assert.equal(data.paymentReceipts.length, 1);
  assert.equal(result.totals.receivedAmount, 400);
  assert.equal(result.totals.outstandingAmount, 600);
});

test("META traffic is split only when source detail is available", () => {
  const data = exportV3State({ leads: [], adDaily: { META: [
    { date: "2026-09-01", leadSpend: 10, trafficSpend: 30, trafficDetailReady: false },
    { date: "2026-09-02", leadSpend: 10, pocketTrafficSpend: 20, builderTrafficSpend: 10, trafficDetailReady: true }
  ] } });
  assert.deepEqual(data.marketingDaily.map((x) => x.channelCode), ["META_LEAD", "META_TRAFFIC_UNSPLIT", "META_LEAD", "META_POCKET_TRAFFIC", "META_BUILDER_TRAFFIC"]);
  assert.equal(reconcileExport(data).totals.marketingSpend, 80);
});

test("new database leads do not create empty deals", () => {
  const data = exportV3State({ leads: [{ id: "L1", status: "신규 DB", expected: 0, contractAmount: 0, payments: [] }], adDaily: {} });
  assert.equal(data.leads.length, 1); assert.equal(data.deals.length, 0);
});
