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

// Review includes unknown H values; an unconfirmed receipt must not hide a contract.
// Reuse the payment report's strict source/header/date validation, never raw memos.
export function buildSheetContractReport(csv, options) {
  const validated = buildSheetPaymentReport(csv, options);
  const values = parseReportCsv(csv), headers = values[0].map(h => h.replace(/\s/g, ''));
  const methodColumns = headers.flatMap((h,i) => h === '계약방식' ? [i] : []);
  if (methodColumns.length > 1) throw Error('sheet_headers_invalid');
  const all = _crmParseContractSource(values, () => 'review-only', options.start)
    .flatMap(g => g.rows).filter(r => r.date <= options.end);
  if (!all.length) throw Error('sheet_source_empty');
  const rows = all.map(r => {
    const rawMethod = methodColumns.length ? String(values[r.row - 1][methodColumns[0]] || '').trim() : '';
    const methods = rawMethod.split(/[,·\s]+/).filter(Boolean);
    const methodKnown = methods.every(m => ['선금','중도금','잔금','완납','지원금','지정일'].includes(m));
    // Display-only allowlist. Never return arbitrary payment notes or memo cells.
    const paymentDisplay = r.paymentPercent !== null ? (r.paymentPercent === 100 ? '✓' : r.paymentPercent + '%') :
      r.paymentAmount ? r.paymentText : /^(?:[1-9]|1[0-2])월(?:내|말)?지급예정$/.test(r.paymentText.replace(/\s/g,'')) ? r.paymentText.replace(/\s/g,'') : r.paymentText ? '확인 필요' : '';
    return { row:r.row, date:r.date, company:r.company, owner:r.owner,
    ctype:r.ctype, dealText:r.dealText, amount:r.amount, service:r.service, taxBasis:r.taxBasis,
    netAmount:r.netAmount, amountDisplay:r.amount !== null ? r.amountRaw : '', paymentDisplay,
    contractMethods:methodKnown ? methods : [], contractMethodStatus:!methodColumns.length ? 'unavailable' : methodKnown ? 'available' : 'unknown',
    paymentPercent:r.paymentPercent, paymentAmount:r.paymentAmount,
    paymentText:r.paymentPercent !== null ? r.paymentPercent + '%' : r.paymentAmount ? r.paymentAmount + '원' : '' };
  });
  return { ok:true, schemaVersion:'contract-review-source-v1', displaySchemaVersion:1, start:options.start, end:options.end,
    fetchedAt:options.fetchedAt, sourceHash:options.sourceHash, sourceRowCount:validated.sourceRowCount,
    rangeRows:rows.length, rows };
}

export async function readSheetPaymentReport({ start,end, mode='payments', fetchImpl=fetch, now=()=>new Date().toISOString() }) {
  const response = await fetchImpl(CONTRACT_SHEET_URL, { signal:AbortSignal.timeout(25000), headers:{accept:'text/csv'} });
  if (!response.ok || /accounts\.google\.com/.test(response.url || '') || !/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type') || '')) throw Error('sheet_source_unavailable');
  if (Number(response.headers.get('content-length') || 0) > 10000000) throw Error('sheet_source_invalid');
  const csv = await response.text();
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const options={start,end,fetchedAt:now(),sourceHash};
  return mode === 'contracts' ? buildSheetContractReport(csv,options) : buildSheetPaymentReport(csv,options);
}

export async function handleSheetReport(request, { authorize, readSource=readSheetPaymentReport }) {
  if (request.method !== 'GET') return { status:405, body:{error:'method_not_allowed'} };
  const access = await authorize(request);
  if (!access.ok) return {status:access.status,body:{error:access.error}};
  if (access.scope !== 'all') return {status:403,body:{error:'scope_action_forbidden'}};
  const url = new URL(request.url), start=url.searchParams.get('start'), end=url.searchParams.get('end');
  const mode=url.searchParams.get('mode') || 'payments';
  if ([...url.searchParams.keys()].some(k=>!['start','end','mode'].includes(k)) || !['payments','contracts'].includes(mode) || !_crmSyncDate(start) || _crmSyncDate(start)!==start || !_crmSyncDate(end) || _crmSyncDate(end)!==end || start>end || start<'2000-01-01' || end>'2100-12-31') return {status:400,body:{error:'sheet_range_invalid'}};
  try { return {status:200,body:await readSource(mode === 'contracts' ? {start,end,mode} : {start,end})}; }
  catch(e) { const code=String(e?.message || ''); return {status:502,body:{error:/^sheet_[a-z_]+$/.test(code)?code:'sheet_source_unavailable'}}; }
}
