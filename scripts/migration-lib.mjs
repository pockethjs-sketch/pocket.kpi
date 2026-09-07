import { createHash } from "node:crypto";

const list = (value) => Array.isArray(value) ? value : [];
const money = (value) => value === "" || value == null ? null : Number(value);
const key = (...parts) => parts.map((part) => String(part ?? "").trim()).join(":");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function normalizeExport(source) {
  const org = String(source.organizationSlug || "pocket-kpi");
  const accounts = list(source.accounts).map((x) => ({ ...x, source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), normalizedName: String(x.name || "").trim().toLowerCase() }));
  const leads = list(source.leads).map((x) => ({ ...x, source: x.source || (x.externalCrmId ? "CRM" : "GOOGLE_SHEETS"), sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "lead", x.externalCrmId || x.sourceRowKey || x.rowKey) }));
  const deals = list(source.deals).map((x) => ({ ...x, quotedAmount: money(x.quotedAmount), contractAmount: money(x.contractAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "deal", x.externalCrmId || x.sourceRowKey || x.rowKey) }));
  const payments = list(source.payments).map((x) => ({ ...x, plannedAmount: money(x.plannedAmount), receivedAmount: money(x.receivedAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "payment", x.sourceRowKey || x.rowKey) }));
  const contractEvents = list(source.contractEvents).map((x) => ({ ...x, contractAmount: money(x.contractAmount), confirmedReceiptAmount: money(x.confirmedReceiptAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), sourceHash: x.sourceHash || hash(x) }));
  const marketingDaily = list(source.marketingDaily).map((x) => ({ ...x, spendAmount: money(x.spendAmount), sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), sourceHash: x.sourceHash || hash(x) }));
  const dealActivity = list(source.dealActivity).map((x) => ({ ...x, source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || "") }));
  return { organizationSlug: org, sourceRevision: source.revision || null, accounts, leads, deals, payments, contractEvents, marketingDaily, dealActivity };
}

export function reconcileExport(data) {
  const invalidRows = [], duplicates = [];
  const domains = ["accounts", "leads", "deals", "payments", "contractEvents", "marketingDaily", "dealActivity"];
  const seen = new Map();
  for (const domain of domains) {
    list(data[domain]).forEach((row, index) => {
      const identity = row.idempotencyKey || key(domain, row.externalCrmId || "", row.source || row.provider || "", row.sourceRowKey || "", row.sourceHash || "");
      if (!row.sourceRowKey && !row.externalCrmId && !row.idempotencyKey) invalidRows.push({ domain, index, reason: "missing_stable_identity" });
      if (seen.has(identity)) duplicates.push({ domain, index, identity, first: seen.get(identity) }); else seen.set(identity, { domain, index });
      for (const field of ["quotedAmount", "contractAmount", "plannedAmount", "receivedAmount", "confirmedReceiptAmount", "spendAmount"]) {
        if (row[field] != null && (!Number.isFinite(row[field]) || row[field] < 0)) invalidRows.push({ domain, index, field, reason: "invalid_money" });
      }
    });
  }
  const sum = (rows, field) => list(rows).reduce((total, row) => total + (Number(row[field]) || 0), 0);
  return {
    counts: Object.fromEntries(domains.map((domain) => [domain, list(data[domain]).length])),
    totals: {
      quotedAmount: sum(data.deals, "quotedAmount"), contractAmount: sum(data.deals, "contractAmount"),
      plannedAmount: sum(data.payments, "plannedAmount"), receivedAmount: sum(data.payments, "receivedAmount"),
      outstandingAmount: Math.max(0, sum(data.deals, "contractAmount") - sum(data.payments, "receivedAmount")),
      marketingSpend: sum(data.marketingDaily, "spendAmount"),
    },
    invalidRows, duplicates,
  };
}
