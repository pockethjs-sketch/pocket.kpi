// Source-only reader. Never return contacts, message bodies or original records.
export function inquiryDay(value) {
  const raw = String(value || '');
  const date = new Date(/[T ]/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw.replace(' ', 'T') + '+09:00' : raw);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function inquiryDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start > end) throw new Error('inquiry_range_invalid');
  const days = [];
  for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
    if (days.length > 3660) throw new Error('inquiry_range_invalid');
  }
  return days;
}
export function inquiryChannel(value) {
  let parts = value;
  if (typeof parts === 'string') { try { parts = JSON.parse(parts); } catch { parts = [parts]; } }
  const text = String(Array.isArray(parts) ? parts[0] || '' : parts || '').toLowerCase();
  return /instagram|facebook|메타/.test(text) ? 'META' : /google|구글/.test(text) ? 'GOOGLE' : /naver|네이버/.test(text) ? 'NAVER' : 'OTHER';
}
const buckets = () => ({ META: 0, NAVER: 0, GOOGLE: 0, OTHER: 0 });
export async function collectWebsiteInquiries({ fetcher = fetch, headers, start, end, now = () => new Date().toISOString(), hash }) {
  const daily = new Map(inquiryDates(start, end).map(date => [date, { date, count: 0, channels: buckets() }]));
  const identities = new Map();
  const stateCounts = { 0: 0, 1: 0 };
  // Ordinary website inquiries. Do not mix membership, events or project registration.
  for (const state of [0, 1]) {
    let offset = 0, expected = null, received = 0;
    const pages = new Set();
    for (let page = 0; page < 500; page++) {
      const url = new URL('https://api.xn--9i1b674cwc38r6pa.com/crm/v3/income_inquiry');
      for (const [key, value] of Object.entries({ iciq_type: 'default', state, offset, limit: 100, start_dt: start + 'T00:00:00+09:00', end_dt: end + 'T23:59:59+09:00' })) url.searchParams.set(key, String(value));
      const response = await fetcher(url.toString(), { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok) throw new Error('inquiry_http_' + response.status);
      const body = await response.json();
      if (!Array.isArray(body?.query)) throw new Error('inquiry_response_invalid');
      const rows = body.query;
      if (page === 0 && rows.length) {
        expected = Number(rows[0].row_count_for_pagination);
        if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('inquiry_count_unavailable');
      }
      if (!rows.length) {
        if (expected != null && received !== expected) throw new Error('inquiry_read_changed');
        break;
      }
      const signature = rows.map(row => String(row.iciq_no || '')).join(':');
      if (pages.has(signature)) throw new Error('inquiry_repeated_page');
      pages.add(signature);
      for (const row of rows) {
        if (row.iciq_type !== 'default' || Number(row.state) !== state) throw new Error('inquiry_filter_mismatch');
        const id = String(row.iciq_no || '');
        const date = inquiryDay(row.reg_dt);
        if (!id || !date) throw new Error('inquiry_identity_or_date_missing');
        if (!daily.has(date)) throw new Error('inquiry_range_mismatch');
        const channel = inquiryChannel(row.iciq_items?.inflow_rt);
        const previous = identities.get(id);
        // A status transition during pagination is not a second inquiry.
        if (previous && (previous.date !== date || previous.channel !== channel)) throw new Error('inquiry_read_changed');
        if (!previous) identities.set(id, { date, channel });
      }
      received += rows.length; offset += rows.length;
      if (page === 499) throw new Error('inquiry_page_limit');
    }
    stateCounts[state] = received;
  }
  for (const { date, channel } of identities.values()) { daily.get(date).count++; daily.get(date).channels[channel]++; }
  const days = [...daily.values()];
  const total = days.reduce((sum, day) => sum + day.count, 0);
  if (total !== identities.size) throw new Error('inquiry_aggregation_mismatch');
  // Only the digest, never the individual source identities, leaves this reader.
  const sourceHash = await hash(JSON.stringify([...identities].sort(([a], [b]) => a.localeCompare(b))));
  return { schemaVersion: 1, source: 'WEBSITE', start, end, total, daily: days, sourceHash, stateCounts, verified: true, completedAt: now() };
}
export async function commitInquiryReport(client, organizationId, report) {
  const { data, error } = await client.rpc('kpi_commit_inquiry_days', {
    p_organization_id: organizationId, p_source: report.source, p_start: report.start, p_end: report.end,
    p_daily: report.daily, p_total: report.total, p_hash: report.sourceHash, p_as_of: report.completedAt,
  });
  if (error || !data?.verified || Number(data.total) !== report.total || Number(data.days) !== report.daily.length) throw new Error('inquiry_storage_mismatch');
  return { ...data, stateCounts: report.stateCounts };
}
export async function recordInquiryFailure(client, organizationId, source, code) {
  const error = /^inquiry_[a-z0-9_]+$/.test(String(code)) ? String(code) : 'inquiry_collection_failed';
  // Update existing status without erasing its last successful timestamp/range.
  const { error: writeError } = await client.from('marketing_inquiry_sync_state').upsert({
    organization_id: organizationId, source, status: 'FAILED', last_attempt_at: new Date().toISOString(), error_code: error,
  }, { onConflict: 'organization_id,source', defaultToNull: false });
  if (writeError) return { verified: false, error: 'inquiry_status_write_failed' };
  return { verified: false, error };
}
