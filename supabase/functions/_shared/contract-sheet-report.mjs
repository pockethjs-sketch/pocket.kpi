import { _crmParseContractSource, _crmSyncDate } from '../../../scripts/contract-sheet-sync-core.mjs';

export const CONTRACT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1vNlj417n1JE0HTOky5FCKS0_Y5daeor7oIok3SXMbss/export?format=csv&gid=0';
export function parseReportCsv(csv) {
  if (typeof csv !== 'string' || csv.length > 10000000 || /^\s*</.test(csv)) throw Error('sheet_source_invalid');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { if (quoted && csv[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw Error('sheet_csv_truncated');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length < 2) throw Error('sheet_source_empty');
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}

export function buildSheetPaymentReport(csv, { start, end, fetchedAt, sourceHash }) {
  if (!_crmSyncDate(start) || _crmSyncDate(start) !== start || !_crmSyncDate(end) || _crmSyncDate(end) !== end || start > end) throw Error('sheet_range_invalid');
  const values = parseReportCsv(csv), headers = values[0].map(x => x.replace(/\s/g, ''));
  // The approved A/H/O semantics are not inferred from approximate header positions.
  if (headers[0] !== '날짜' || headers[7] !== '대금지급확인' || headers[14] !== '별도가') throw Error('sheet_headers_invalid');
  let groups;
  try { groups = _crmParseContractSource(values, () => 'report-only', start); }
  catch { throw Error('sheet_headers_invalid'); }
  const ix = Object.fromEntries(headers.map((h, i) => [h, i]));
  if (values.slice(1).some(v => (String(v[ix['프로젝트']] || '').trim() || String(v[14] || '').trim()) &&
      ((String(v[0] || '').trim() && !_crmSyncDate(v[0])) || (String(v[ix['업체명']] || '').trim() && !String(v[0] || '').trim())))) throw Error('sheet_row_date_invalid');
  const all = groups.flatMap(g => g.rows).filter(r => r.date <= end);
  const signatures = all.map(r => JSON.stringify([r.company,r.date,r.owner,r.ctype,r.dealText,r.amount,r.paymentPercent,r.paymentAmount]));
  const counts = new Map(); signatures.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
  const rows = [], issues = [];
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const issue = code => issues.push({ sourceRow:r.row, date:r.date, code });
    if (counts.get(signatures[i]) > 1) { issue('duplicate_source_row'); continue; }
    if (r.amount == null || !r.dealText) { issue('sheet_amount_unknown'); continue; }
    if (r.paymentPercent === null && !r.paymentAmount) { issue('sheet_payment_unconfirmed'); continue; }
    const amount = r.paymentPercent !== null ? Math.round(r.amount * r.paymentPercent / 100) : r.paymentAmount;
    if (amount > r.amount) { issue('sheet_payment_exceeds_contract'); continue; }
    if (amount <= 0) continue;
    rows.push({ sourceRow:r.row, date:r.date, company:r.company, owner:r.owner || '미배정', ctype:r.ctype || '미확인', program:r.dealText,
      contractAmount:r.amount, amount, percent:r.paymentPercent, taxBasis:r.taxBasis });
  }
  return { ok:true, schemaVersion:'sheet-payment-report-v1', basis:'sheet-date-current-confirmation', start,end,fetchedAt,sourceHash,
    sourceRowCount:values.length, rangeRows:all.length, confirmedRows:rows.length, total:rows.reduce((s,r)=>s+r.amount,0), rows,issues };
}

export async function readSheetPaymentReport({ start,end, fetchImpl=fetch, now=()=>new Date().toISOString() }) {
  const response = await fetchImpl(CONTRACT_SHEET_URL, { signal:AbortSignal.timeout(25000), headers:{accept:'text/csv'} });
  if (!response.ok || /accounts\.google\.com/.test(response.url || '') || !/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type') || '')) throw Error('sheet_source_unavailable');
  if (Number(response.headers.get('content-length') || 0) > 10000000) throw Error('sheet_source_invalid');
  const csv = await response.text();
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  return buildSheetPaymentReport(csv,{start,end,fetchedAt:now(),sourceHash});
}

export async function handleSheetReport(request, { authorize, readSource=readSheetPaymentReport }) {
  if (request.method !== 'GET') return { status:405, body:{error:'method_not_allowed'} };
  const access = await authorize(request);
  if (!access.ok) return {status:access.status,body:{error:access.error}};
  if (access.scope !== 'all') return {status:403,body:{error:'scope_action_forbidden'}};
  const url = new URL(request.url), start=url.searchParams.get('start'), end=url.searchParams.get('end');
  if ([...url.searchParams.keys()].some(k=>!['start','end'].includes(k)) || !_crmSyncDate(start) || _crmSyncDate(start)!==start || !_crmSyncDate(end) || _crmSyncDate(end)!==end || start>end || start<'2000-01-01' || end>'2100-12-31') return {status:400,body:{error:'sheet_range_invalid'}};
  try { return {status:200,body:await readSource({start,end})}; }
  catch(e) { const code=String(e?.message || ''); return {status:502,body:{error:/^sheet_[a-z_]+$/.test(code)?code:'sheet_source_unavailable'}}; }
}
