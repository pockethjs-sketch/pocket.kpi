// A supplemental grant, NOT an EDITOR role. No direct table privileges change.
export const RECEIVABLES_WRITE_PROFILE = 'premeeting_receivables';
export const RECEIVABLES_WRITE_PAGES = ['deals', 'ltvExpansion'];
const stages = new Set(['프리미팅 확정', '프리미팅 완료', '견적·제안 발송', '계약 완료']);
const fields = new Set([
  'company', 'contact', 'phone', 'email', 'memo', 'salesOwner', 'tmOwner',
  'buildup', 'buildups', 'lineItems', 'ctype', 'grade', 'score',
  'status', 'premeetingAt', 'premeetingDoneAt', 'bookedAt', 'contractAt',
  'expected', 'contractAmount', 'paid', 'payments', 'history', 'paymentLogs', 'pushLog',
  'vendorPreOwner', 'vendorGuideOwner', 'vendorNote', 'vendorDepositText', 'vendorBalanceText',
  'vendorImportStatus', 'vendorImportPaymentState',
  'balanceLedgerState', 'balanceLedgerArchivedAt', 'balanceLedgerArchivedBy',
]);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const safe = value => !value || typeof value !== 'object' || Object.entries(value).every(([key, item]) =>
  !['__proto__', 'constructor', 'prototype'].includes(key) && safe(item));
export const isReceivablesEditableLead = lead => !!lead && !lead.archived_at && stages.has(lead.status);
const preservesHistory = (before, after) => Array.isArray(after) && (before || []).every(row =>
  after.some(candidate => JSON.stringify(candidate) === JSON.stringify(row)));

export function validateReceivablesMutation(mutation, state) {
  if (!object(mutation) || !safe(mutation) || mutation.schemaVersion !== 3 || mutation.origin !== 'user') return false;
  if (Object.keys(mutation).some(key => !['schemaVersion','origin','reason','actor','allowedRemovals','collections','documents','deleteDocuments','changedCount'].includes(key))) return false;
  if (!object(mutation.collections) || Object.keys(mutation.documents || {}).length || (mutation.deleteDocuments || []).length) return false;
  if (Object.values(mutation.allowedRemovals || {}).some(ids => !Array.isArray(ids) || ids.length)) return false;
  const leads = new Map((state?.leads || []).map(lead => [String(lead.id), lead]));
  let changed = false;
  for (const [collection, batch] of Object.entries(mutation.collections)) {
    if (!['leads','contractStatusLogs','contractEvents'].includes(collection) || !object(batch) || batch.idField !== 'id') return false;
    if (Object.keys(batch).some(key => !['idField','patches','upsert','remove'].includes(key))) return false;
    if (![batch.patches, batch.upsert, batch.remove].every(Array.isArray) || batch.remove.length) return false;
    if (collection === 'leads') {
      // Existing records only. Creation, deletion and source/sync metadata are not this grant.
      if (batch.upsert.length) return false;
      for (const patch of batch.patches) {
        const lead = leads.get(String(patch.id));
        if (!isReceivablesEditableLead(lead) || !Array.isArray(patch.ops) || !patch.ops.length || Object.keys(patch).some(k => !['id','ops'].includes(k))) return false;
        for (const op of patch.ops) {
          if (!object(op) || Object.keys(op).some(k => !['op','path','value'].includes(k)) || !['set','delete'].includes(op.op) || !Array.isArray(op.path) || !op.path.length || !op.path.every(k => typeof k === 'string') || !fields.has(op.path[0])) return false;
          const field = op.path[0];
          if (op.path.some(k => ['__proto__','constructor','prototype'].includes(k)) || (op.path.length !== 1 && field !== 'score')) return false;
          if (field === 'status' && (op.op !== 'set' || !stages.has(op.value))) return false;
          if (['expected','contractAmount','paid'].includes(field) && (op.op !== 'set' || !Number.isFinite(op.value) || op.value < 0)) return false;
          if (['history','paymentLogs'].includes(field) && (op.op !== 'set' || !preservesHistory(lead[field], op.value))) return false;
          if (field === 'payments' && (op.op !== 'set' || !Array.isArray(op.value) || op.value.some(p => !object(p) || !p.id || !Number.isFinite(p.amount) || p.amount < 0) || new Set(op.value.map(p => String(p.id))).size !== op.value.length)) return false;
          changed = true;
        }
      }
    } else {
      if (batch.patches.length) return false;
      const existing = new Set((state?.[collection] || []).map(row => String(row.id)));
      for (const row of batch.upsert) {
        if (!object(row) || !row.id || existing.has(String(row.id)) || !isReceivablesEditableLead(leads.get(String(row.leadId)))) return false;
        existing.add(String(row.id)); changed = true;
      }
    }
  }
  return changed;
}
