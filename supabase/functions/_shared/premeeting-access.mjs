export const PREMEETING_STAGES = ['프리미팅 확정', '프리미팅 완료', '견적·제안 발송', '계약 완료'];
export const isPremeetingLead = lead => !!lead && !lead.archived_at && PREMEETING_STAGES.includes(lead.status);
export const isPremeetingOnly = access => access?.scope === 'premeeting';

export function canAccessAction(access, action, body = {}) {
  if (!isPremeetingOnly(access)) return true;
  if (['session', 'meta', 'bootstrap', 'crm', 'mutation'].includes(action)) return true;
  return action === 'sheet_bridge' && ['contract_changes', 'contract_change_status', 'contract_auto_sync', 'premeeting_sync', 'daily_sync_status'].includes(body.sheetAction);
}

export function premeetingDocuments(documents, leads) {
  const ids = new Set(leads.filter(isPremeetingLead).map(l => String(l.id)));
  return {
    users: (documents.users || []).map(u => ({ id: u.id, name: u.name, team: u.team, role: u.role })),
    contractStatusLogs: (documents.contractStatusLogs || []).filter(x => ids.has(String(x.leadId))),
    contractEvents: (documents.contractEvents || []).filter(x => ids.has(String(x.leadId))),
  };
}

// Validate against current server rows, not IDs/types asserted by the caller.
export function validatePremeetingMutation(mutation, leads, documents = {}) {
  const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
  if (!object(mutation) || Object.keys(mutation).some(k => !['schemaVersion','origin','reason','actor','allowedRemovals','collections','documents','deleteDocuments','changedCount'].includes(k))) return false;
  if (mutation.documents != null && (!object(mutation.documents) || Object.keys(mutation.documents).length)) return false;
  if (mutation.deleteDocuments != null && (!Array.isArray(mutation.deleteDocuments) || mutation.deleteDocuments.length)) return false;
  const collections = mutation.collections || {};
  if (!object(collections)) return false;
  if (Object.keys(collections).some(k => !['leads', 'contractStatusLogs', 'contractEvents'].includes(k))) return false;
  for (const batch of Object.values(collections)) {
    if (!object(batch) || (batch.idField && batch.idField !== 'id') || Object.keys(batch).some(k => !['idField','upsert','patches','remove'].includes(k))) return false;
    if (['upsert','patches','remove'].some(k => batch[k] != null && !Array.isArray(batch[k]))) return false;
  }
  const all = new Map(leads.map(l => [String(l.id), l]));
  const allowed = new Set(leads.filter(isPremeetingLead).map(l => String(l.id)));
  const changes = collections.leads || {};
  for (const row of changes.upsert || []) {
    if (!row?.id || !isPremeetingLead(row)) return false;
    if (all.has(String(row.id)) && !allowed.has(String(row.id))) return false;
    allowed.add(String(row.id));
  }
  for (const row of changes.patches || []) {
    if (!object(row) || !allowed.has(String(row.id)) || !Array.isArray(row.ops)) return false;
    for (const op of row.ops || []) {
      if (!object(op) || !['set','delete'].includes(op.op) || !Array.isArray(op.path) || !op.path.length || ['id','archived_at'].includes(op.path[0]) || op.path.some(x => ['__proto__','prototype','constructor'].includes(String(x)))) return false;
    }
  }
  if ((changes.remove || []).some(id => !allowed.has(String(id)))) return false;
  for (const key of ['contractStatusLogs', 'contractEvents']) {
    const batch = collections[key]; if (!batch) continue;
    // Logs are append-only for limited employees. Existing source events remain unchanged.
    if ((batch.patches || []).length || (batch.remove || []).length) return false;
    const existing = new Map((documents[key] || []).map(x => [String(x.id), x]));
    for (const row of batch.upsert || []) {
      if (!row?.id || !allowed.has(String(row.leadId)) || existing.has(String(row.id))) return false;
    }
  }
  return Object.values(collections).every(batch => batch && (!batch.idField || batch.idField === 'id') &&
    Object.keys(batch).every(key => ['idField', 'upsert', 'patches', 'remove'].includes(key)));
}
