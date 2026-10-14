// Latest version per CRM schedule; never return contacts or raw notes.
export function crmCalendar(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const key = String(row.external_id || '');
    if (!key) continue;
    const previous = latest.get(key);
    if (!previous || String(row.last_seen_at) > String(previous.last_seen_at)
      || (row.last_seen_at === previous.last_seen_at && Number(row.id) > Number(previous.id))) latest.set(key, row);
  }
  return [...latest.values()].flatMap(row => {
    const p = row.payload || {};
    if (Number(p.mr_type) !== 1 || !p.start_dt) return [];
    return [{ msNo: row.external_id, type: 1, startAt: p.start_dt, checked: Number(p.mr_checked) || 0,
      projNo: p.proj_no ?? null, clientNo: p.client_no ?? null,
      company: String(p.client_rep_name || p.client_name || p.mr_name || 'CRM 업체 미등록'),
      owner: (Array.isArray(p.managers) ? p.managers : []).map(m => m.emp_name).filter(Boolean).join(', ') }];
  });
}
