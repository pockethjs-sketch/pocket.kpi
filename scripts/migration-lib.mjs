import { createHash } from "node:crypto";

const list = (value) => Array.isArray(value) ? value : [];
const money = (value) => value === "" || value == null ? null : Number(value);
const key = (...parts) => parts.map((part) => String(part ?? "").trim()).join(":");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function normalizeExport(source) {
  if (source && typeof source.data === "string") return exportV3State(JSON.parse(source.data), source.revision);
  if (source && Array.isArray(source.leads) && !Array.isArray(source.accounts)) return exportV3State(source, source.revision);
  const org = String(source.organizationSlug || "pocket-kpi");
  const accounts = list(source.accounts).map((x) => ({ ...x, source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), normalizedName: String(x.name || "").trim().toLowerCase() }));
  const leads = list(source.leads).map((x) => ({ ...x, source: x.source || (x.externalCrmId ? "CRM" : "GOOGLE_SHEETS"), sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "lead", x.externalCrmId || x.sourceRowKey || x.rowKey) }));
  const deals = list(source.deals).map((x) => ({ ...x, quotedAmount: money(x.quotedAmount), contractAmount: money(x.contractAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "deal", x.externalCrmId || x.sourceRowKey || x.rowKey) }));
  const payments = list(source.payments).map((x) => ({ ...x, plannedAmount: money(x.plannedAmount), receivedAmount: money(x.receivedAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), idempotencyKey: key(org, "payment", x.sourceRowKey || x.rowKey) }));
  const paymentReceipts = list(source.paymentReceipts).length
    ? list(source.paymentReceipts).map((x) => ({ ...x, receivedAmount: money(x.receivedAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || "") }))
    : payments.filter((x) => (x.receivedAmount || 0) > 0).map((x) => ({ rowKey: `receipt:${x.sourceRowKey}`, paymentRowKey: x.rowKey, dealRowKey: x.dealRowKey, receivedAmount: x.receivedAmount, source: x.source, sourceRowKey: `receipt:${x.sourceRowKey}` }));
  const contractEvents = list(source.contractEvents).map((x) => ({ ...x, contractAmount: money(x.contractAmount), confirmedReceiptAmount: money(x.confirmedReceiptAmount), source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), sourceHash: x.sourceHash || hash(x) }));
  const marketingDaily = list(source.marketingDaily).map((x) => ({ ...x, spendAmount: money(x.spendAmount), sourceRowKey: String(x.sourceRowKey || x.rowKey || ""), sourceHash: x.sourceHash || hash(x) }));
  const dealActivity = list(source.dealActivity).map((x) => ({ ...x, source: x.source || "GOOGLE_SHEETS", sourceRowKey: String(x.sourceRowKey || x.rowKey || "") }));
  return { organizationSlug: org, sourceRevision: source.revision || null, accounts, leads, deals, payments, paymentReceipts, contractEvents, marketingDaily, dealActivity };
}

const isoDate = (value) => value ? String(value).slice(0, 10) : null;
const text = (value) => value == null ? "" : String(value).trim();

export function exportV3State(state, revision = null) {
  const organizationSlug = "pocket-kpi";
  const accounts = [], leads = [], deals = [], payments = [], paymentReceipts = [], contractEvents = [], marketingDaily = [], dealActivity = [];
  for (const [index, lead] of list(state.leads).entries()) {
    const leadKey = text(lead.id) || (lead.projNo != null ? `crm-${lead.projNo}` : `sheet-lead-${index + 1}`);
    const accountKey = `account:${leadKey}`;
    accounts.push({ rowKey: accountKey, name: text(lead.company) || "이름 미입력", externalCrmId: lead.projNo == null ? null : text(lead.projNo), source: lead.projNo == null ? "GOOGLE_SHEETS" : "CRM", sourceRowKey: accountKey, fieldOwners: { name: lead.projNo == null ? "USER" : "CRM" } });
    leads.push({ rowKey: leadKey, accountRowKey: accountKey, externalCrmId: lead.projNo == null ? null : text(lead.projNo), acquiredOn: isoDate(lead.createdAt), channel: text(lead.channel), statusCode: text(lead.status) || "UNKNOWN", notes: text(lead.memo), source: lead.projNo == null ? "GOOGLE_SHEETS" : "CRM", sourceRowKey: `lead:${leadKey}`, fieldOwners: { statusCode: "USER", notes: "USER", channel: lead.projNo == null ? "USER" : "CRM" } });
    const hasDeal = text(lead.status) !== "신규 DB" || (money(lead.contractAmount) || 0) > 0 || (money(lead.expected) || 0) > 0 || list(lead.payments).length > 0 || Boolean(text(lead.contractAt));
    if (!hasDeal) continue;
    const dealKey = `deal:${leadKey}`;
    deals.push({ rowKey: dealKey, accountRowKey: accountKey, leadRowKey: leadKey, externalCrmId: lead.projNo == null ? null : text(lead.projNo), serviceCode: text(lead.buildup), stageCode: text(lead.status) || "UNKNOWN", quotedAmount: money(lead.expected), contractAmount: money(lead.contractAmount), contractedOn: isoDate(lead.contractAt), source: "GOOGLE_SHEETS", sourceRowKey: dealKey, fieldOwners: { quotedAmount: "USER", contractAmount: "USER", contractedOn: "USER", stageCode: "USER" } });
    let confirmedTotal = 0;
    for (const [paymentIndex, payment] of list(lead.payments).entries()) {
      const paymentKey = `payment:${leadKey}:${text(payment.id) || paymentIndex + 1}`;
      const amount = money(payment.amount) || 0;
      payments.push({ rowKey: paymentKey, dealRowKey: dealKey, installmentCode: text(payment.kind || payment.label || payment.no) || `INSTALLMENT_${paymentIndex + 1}`, plannedAmount: amount, dueOn: isoDate(payment.dueAt), status: payment.paidConfirmed || payment.paidAt ? "PAID" : "PLANNED", source: "GOOGLE_SHEETS", sourceRowKey: paymentKey, fieldOwners: { plannedAmount: "USER", dueOn: "USER", status: "USER" } });
      if (payment.paidConfirmed || payment.paidAt) {
        confirmedTotal += amount;
        paymentReceipts.push({ rowKey: `receipt:${paymentKey}`, paymentRowKey: paymentKey, dealRowKey: dealKey, receivedAmount: amount, receivedOn: isoDate(payment.paidAt || payment.updatedAt || lead.contractAt || lead.createdAt), paymentMethod: text(payment.method), note: text(payment.memo), source: "GOOGLE_SHEETS", sourceRowKey: `receipt:${paymentKey}` });
      }
    }
    const leadPaid = money(lead.paid) || 0;
    if (leadPaid > confirmedTotal) paymentReceipts.push({ rowKey: `receipt:${dealKey}:paid-residual`, paymentRowKey: null, dealRowKey: dealKey, receivedAmount: leadPaid - confirmedTotal, receivedOn: isoDate(lead.contractAt || lead.createdAt), note: "V3 lead.paid에서 완료 회차 합계를 제외한 잔여 실입금", source: "GOOGLE_SHEETS", sourceRowKey: `receipt:${dealKey}:paid-residual` });
  }
  for (const event of list(state.contractEvents)) contractEvents.push({ rowKey: text(event.id || event.sourceKey), dealRowKey: `deal:${text(event.leadId)}`, eventType: "CONTRACT_IMPORTED", eventAt: event.appliedAt || event.lastDate || event.firstDate, contractAmount: money(event.amount), confirmedReceiptAmount: money(event.numericPaid), source: "GOOGLE_SHEETS", sourceRowKey: text(event.sourceKey || event.id), sourceHash: text(event.sourceHash), payload: { sourceRows: event.sourceRows || [], paymentChecked: Boolean(event.paymentChecked) } });
  for (const log of list(state.contractStatusLogs)) dealActivity.push({ rowKey: text(log.id), dealRowKey: log.leadId ? `deal:${text(log.leadId)}` : null, actionCode: text(log.action) || "UNKNOWN", path: text(log.source), detail: text(log.detail), actor: text(log.actor), occurredAt: log.at || log.date, source: "GOOGLE_SHEETS", sourceRowKey: `contract-status:${text(log.id)}`, metadata: log.meta || {} });
  for (const [providerName, rows] of Object.entries(state.adDaily || {})) {
    const provider = providerName === "GOOGLE" ? "GOOGLE_ADS" : providerName;
    for (const row of list(rows)) {
      const base = `ad:${provider}:${text(row.date)}`;
      if (provider === "META") {
        const channels = [{ code: "META_LEAD", amount: money(row.leadSpend) || 0 }];
        if (row.trafficDetailReady) channels.push({ code: "META_POCKET_TRAFFIC", amount: money(row.pocketTrafficSpend) || 0 }, { code: "META_BUILDER_TRAFFIC", amount: money(row.builderTrafficSpend) || 0 });
        else channels.push({ code: "META_TRAFFIC_UNSPLIT", amount: money(row.trafficSpend) || 0 });
        for (const channel of channels) marketingDaily.push({ rowKey: `${base}:${channel.code}`, provider, spendDate: isoDate(row.date), channelCode: channel.code, spendAmount: channel.amount, impressions: row.impressions ?? null, clicks: row.clicks ?? null, conversions: row.crm ?? null, sourceRowKey: `${base}:${channel.code}` });
      } else marketingDaily.push({ rowKey: `${base}:${provider}`, provider, spendDate: isoDate(row.date), channelCode: provider, spendAmount: money(row.spend) || 0, impressions: row.impressions ?? null, clicks: row.clicks ?? null, conversions: row.crm ?? null, sourceRowKey: `${base}:${provider}` });
    }
  }
  return { organizationSlug, sourceRevision: revision, accounts, leads, deals, payments, paymentReceipts, contractEvents, marketingDaily, dealActivity };
}

export function reconcileExport(data) {
  const invalidRows = [], duplicates = [];
  const domains = ["accounts", "leads", "deals", "payments", "paymentReceipts", "contractEvents", "marketingDaily", "dealActivity"];
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
  const receiptsByDeal = new Map();
  for (const receipt of list(data.paymentReceipts)) receiptsByDeal.set(receipt.dealRowKey, (receiptsByDeal.get(receipt.dealRowKey) || 0) + (Number(receipt.receivedAmount) || 0));
  const outstandingAmount = list(data.deals).reduce((total, deal) => total + Math.max(0, (Number(deal.contractAmount) || 0) - (receiptsByDeal.get(deal.rowKey) || 0)), 0);
  return {
    counts: Object.fromEntries(domains.map((domain) => [domain, list(data[domain]).length])),
    totals: {
      quotedAmount: sum(data.deals, "quotedAmount"), contractAmount: sum(data.deals, "contractAmount"),
      plannedAmount: sum(data.payments, "plannedAmount"), receivedAmount: sum(data.paymentReceipts, "receivedAmount"),
      outstandingAmount,
      marketingSpend: sum(data.marketingDaily, "spendAmount"),
    },
    invalidRows, duplicates,
  };
}
