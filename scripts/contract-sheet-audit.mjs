// Read-only monitoring. Source names/notes stay in memory, never in output or SQL.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { _crmParseContractSource, _crmSyncPaymentPercent, _crmSyncDate } from './contract-sheet-sync-core.mjs';

export const CONTRACT_SOURCE_ID = '1vNlj417n1JE0HTOky5FCKS0_Y5daeor7oIok3SXMbss';
const ORGANIZATION = 'c9e1a7bd-f412-4fc5-a002-2226c5c586fd';
const digest = (s, algorithm = 'sha256') => createHash(algorithm).update(String(s)).digest('hex');
const isoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export function parseContractCsv(csv) {
  if (typeof csv !== 'string' || csv.length > 10_000_000) throw Error('SOURCE_SIZE_INVALID');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { if (quoted && csv[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw Error('SOURCE_CSV_TRUNCATED');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length < 2) throw Error('SOURCE_NO_ROWS');
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}

export function contractAuditEvidence(csv, { from = '2026-09-01', now = new Date().toISOString() } = {}) {
  if (!isoDate(from) || !Number.isFinite(Date.parse(now))) throw Error('AUDIT_RANGE_INVALID');
  const through = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  if (from > through) throw Error('AUDIT_RANGE_INVALID');
  const values = parseContractCsv(csv);
  const headers = values[0].map(x => x.replace(/\s/g, ''));
  const proofIndex = headers.indexOf('입금확인업로드');
  let parsed;
  try { parsed = _crmParseContractSource(values, digest, from); }
  catch { throw Error('SOURCE_HEADERS_OR_VALUES_INVALID'); }
  const dateIndex = headers.indexOf('날짜'), companyIndex = headers.indexOf('업체명');
  const projectIndex = headers.indexOf('프로젝트'), amountIndex = headers.indexOf('별도가');
  // A malformed populated contract row must not disappear and make the audit pass.
  if (values.slice(1).some(row => {
    const populated = String(row[projectIndex] || '').trim() || String(row[amountIndex] || '').trim();
    const date = String(row[dateIndex] || '').trim();
    return populated && ((date && !_crmSyncDate(date)) || (String(row[companyIndex] || '').trim() && !date));
  })) throw Error('SOURCE_ROW_DATE_INVALID');
  const evidence = parsed.map(g => ({
    keyHash: digest(g.sourceKey, 'md5'), aliasHashes: g.aliases.map(a => digest(a, 'md5')),
    sourceHash: g.sourceHash, amount: g.amount, amountKnown: g.amountKnown, duplicate: g.duplicateRows,
    rows: g.rows.map(r => ({ row: r.row, date: r.date, amount: r.amount, percent: r.paymentPercent,
      known: !!r.dealText && r.amount > 0, repeat: /추가|연장|월관리|매월|월운영/.test(r.memo + ' ' + r.dealText),
      proof: proofIndex >= 0 && _crmSyncPaymentPercent(values[r.row - 1]?.[proofIndex]) === 100,
    })),
  }));
  if (!evidence.length) throw Error('SOURCE_NO_ROWS_IN_RANGE');
  return { schemaVersion: 'contract-audit-v1', from, through, fetchedAt: now,
    sourceHash: digest(csv), sourceRowCount: values.length, sourceGroups: evidence.length, evidence };
}

export async function readContractAuditSource({ fetchImpl = fetch, now, from } = {}) {
  let response, csv;
  try {
    response = await fetchImpl(`https://docs.google.com/spreadsheets/d/${CONTRACT_SOURCE_ID}/export?format=csv&gid=0`,
      { signal: AbortSignal.timeout(25000) });
    if (!response.ok || /accounts\.google\.com/.test(response.url || '') ||
      !/csv|octet-stream|text\/plain/i.test(response.headers.get('content-type') || '')) throw Error('SOURCE_UNAVAILABLE');
    csv = await response.text();
  } catch { throw Error('SOURCE_UNAVAILABLE'); }
  return contractAuditEvidence(csv, { now, from });
}

export function makeContractAuditSql(bundle) {
  if (bundle?.schemaVersion !== 'contract-audit-v1' || !isoDate(bundle.from) || !isoDate(bundle.through) ||
    !Array.isArray(bundle.evidence) || bundle.evidence.length < 1 || bundle.evidence.length > 5000 ||
    !/^[a-f0-9]{64}$/.test(bundle.sourceHash)) throw Error('AUDIT_EVIDENCE_INVALID');
  for (const g of bundle.evidence) {
    if (!/^[a-f0-9]{32}$/.test(g.keyHash) || !Array.isArray(g.aliasHashes) || g.aliasHashes.some(a => !/^[a-f0-9]{32}$/.test(a)) ||
      !Array.isArray(g.rows) || !g.rows.length || g.rows.some(r => !isoDate(r.date) || !Number.isInteger(r.row) || r.row < 2 ||
        (r.percent !== null && (!Number.isFinite(r.percent) || r.percent < 0 || r.percent > 100)))) throw Error('AUDIT_EVIDENCE_INVALID');
  }
  const literal = JSON.stringify(bundle).replaceAll("'", "''");
  // Existing administrator MCP only. This query neither changes data nor calls a mutating RPC.
  return `with bundle as(select '${literal}'::jsonb b),
  evidence as(select e from bundle cross join lateral jsonb_array_elements(b->'evidence') e),
  state as(select primary_revision,state_snapshot from public.app_current_state where organization_id='${ORGANIZATION}'),
  raw as(select l,regexp_replace(l->>'company','\\(주\\)|㈜','','g') raw from state cross join lateral jsonb_array_elements(state_snapshot->'leads') l
    where coalesce(l->>'archivedAt','')='' and coalesce(l->>'archived_at','')=''),
  aliasraw as(select l,raw a from raw where raw!~'[/·,]' union all
    select l,regexp_replace(raw,'\\([^)]*\\)','','g') from raw where raw!~'[/·,]' union all
    select l,m[1] from raw cross join lateral regexp_matches(raw,'\\(([^)]+)\\)','g') m where raw!~'[/·,]' and m[1]!~'대표|담당|이사|팀장'),
  aliases as(select l,regexp_replace(regexp_replace(lower(a),'\\(주\\)|㈜|주식회사|유한회사','','g'),'[^a-z0-9가-힣]','','g') a from aliasraw),
  matches as(select distinct e,l from evidence join aliases on length(a)>=2 and e->'aliasHashes' ? md5(a)),
  grouped as(select e,count(l) match_count,coalesce(jsonb_agg(l) filter(where l is not null),'[]') ls from evidence left join matches using(e) group by e),
  selected as(select *,case when match_count=1 then ls->0
    when jsonb_array_length(e->'rows')=1 and (select count(*) from jsonb_array_elements(ls) x where x->>'contractAt'=e#>>'{rows,0,date}')=1
    then(select x from jsonb_array_elements(ls) x where x->>'contractAt'=e#>>'{rows,0,date}') end lead from grouped),
  financial as(select *,
    (select count(*) from public.leads r where r.organization_id='${ORGANIZATION}' and r.archived_at is null and r.source_payload->>'id'=lead->>'id') relational_count,
    (select r.id from public.leads r where r.organization_id='${ORGANIZATION}' and r.archived_at is null and r.source_payload->>'id'=lead->>'id' limit 1) relational_id,
    coalesce((select sum((p->>'amount')::numeric) from jsonb_array_elements(coalesce(lead->'payments','[]')) p),0) schedule_total,
    coalesce((select sum(case when coalesce((p->>'crmManaged')::boolean,false) then coalesce((p->>'depositAmount')::numeric,0)
      when coalesce(p->>'paidAt','')<>'' or coalesce((p->>'paidConfirmed')::boolean,false) then (p->>'amount')::numeric else 0 end)
      from jsonb_array_elements(coalesce(lead->'payments','[]')) p),0) schedule_paid from selected),
  ledger as(select *,
    (select count(*) from public.deals d where d.organization_id='${ORGANIZATION}' and d.archived_at is null and d.lead_id=relational_id) deal_count,
    (select sum(d.contract_amount) from public.deals d where d.organization_id='${ORGANIZATION}' and d.archived_at is null and d.lead_id=relational_id) ledger_contract,
    (select coalesce(sum(r.received_amount),0) from public.payment_receipts r join public.deals d on d.id=r.deal_id
      where d.organization_id='${ORGANIZATION}' and d.archived_at is null and r.archived_at is null and d.lead_id=relational_id) ledger_paid,
    (select r.source_payload from public.leads r where r.id=relational_id) relational_payload from financial),
  checked as(select *,array_remove(array[
    case when jsonb_array_length(e->'rows')<>1 then 'MULTIPLE_SOURCE_CONTRACTS' end,
    case when (e->>'duplicate')::boolean then 'DUPLICATE_SOURCE_ROWS' end,
    case when not(e->>'amountKnown')::boolean then 'SOURCE_AMOUNT_UNKNOWN' end,
    case when exists(select 1 from jsonb_array_elements(e->'rows') r where (r->>'date')::date>(select (b->>'through')::date from bundle)) then 'FUTURE_SOURCE_CONTRACT' end,
    case when lead is null then case when match_count=0 then 'UNMATCHED' else 'AMBIGUOUS' end end,
    case when lead is not null and coalesce(lead->>'contractAt','')<>e#>>'{rows,0,date}' then 'CONTRACT_DATE_MISMATCH' end,
    case when lead is not null and lead->>'status'<>'계약 완료' then 'STATUS_MISMATCH' end,
    case when lead is not null and jsonb_array_length(e->'rows')=1 and lead->>'contractAt'=e#>>'{rows,0,date}'
      and (e->>'amountKnown')::boolean and coalesce((lead->>'contractAmount')::numeric,0)<>(e->>'amount')::numeric then 'CONTRACT_AMOUNT_MISMATCH' end,
    case when lead is not null and jsonb_array_length(e->'rows')=1 and lead->>'contractAt'=e#>>'{rows,0,date}'
      and e#>>'{rows,0,percent}' is not null and (e->>'amountKnown')::boolean
      and coalesce((lead->>'paid')::numeric,0)<>round((e->>'amount')::numeric*(e#>>'{rows,0,percent}')::numeric/100) then 'CONFIRMED_PAYMENT_MISMATCH' end,
    case when exists(select 1 from jsonb_array_elements(e->'rows') r where (r->>'proof')::boolean and r->>'percent' is null) then 'PROOF_WITHOUT_PAYMENT_STATUS' end,
    case when lead is not null and schedule_total<>coalesce((lead->>'contractAmount')::numeric,0) then 'SCHEDULE_TOTAL_MISMATCH' end,
    case when lead is not null and schedule_paid<>coalesce((lead->>'paid')::numeric,0) then 'SCHEDULE_PAID_MISMATCH' end,
    case when lead is not null and jsonb_array_length(e->'rows')=1 and lead->>'contractAt'=e#>>'{rows,0,date}'
      and e#>>'{rows,0,percent}' is not null and exists(select 1 from jsonb_array_elements(coalesce(lead->'payments','[]')) p
        where p->>'paidConfirmed' is distinct from 'true' and (coalesce(p->>'paidAt','')<>'' or e#>>'{rows,0,percent}'='100')) then 'PAYMENT_COMPLETION_FLAG_MISSING' end,
    case when lead is not null and (relational_count<>1 or deal_count<>1) then 'RELATIONAL_IDENTITY_UNVERIFIED' end,
    case when lead is not null and (ledger_contract is distinct from coalesce((lead->>'contractAmount')::numeric,0)
      or ledger_paid is distinct from coalesce((lead->>'paid')::numeric,0)
      or relational_payload->'paid' is distinct from lead->'paid'
      or relational_payload->'payments' is distinct from lead->'payments') then 'RELATIONAL_SNAPSHOT_MISMATCH' end
  ],null) issues from ledger),
  report as(select e->>'keyHash' key_hash,issues,match_count,
    (select jsonb_agg(r->'row') from jsonb_array_elements(e->'rows') r) source_rows,
    md5(coalesce(e->>'amount','')||coalesce((select string_agg((r-'row')::text,',' order by (r-'row')::text) from jsonb_array_elements(e->'rows') r),'')||
      coalesce(lead->>'contractAt','')||coalesce(lead->>'contractAmount','')||coalesce(lead->>'paid','')||coalesce(ledger_paid::text,'')||coalesce((lead->'payments')::text,'')) value_hash
    from checked)
  select jsonb_build_object('schemaVersion','contract-audit-v1','sourceHash',(select b->>'sourceHash' from bundle),
    'from',(select b->>'from' from bundle),'through',(select b->>'through' from bundle),
    'sourceFetchedAt',(select b->>'fetchedAt' from bundle),'databaseCheckedAt',clock_timestamp(),
    'revision',(select primary_revision from state),'sourceGroups',(select jsonb_array_length(b->'evidence') from bundle),
    'auditedGroups',count(*),'aligned',count(*) filter(where cardinality(issues)=0),'unresolved',count(*) filter(where cardinality(issues)>0),
    'paymentNotCompared',(select count(*) from checked where jsonb_array_length(e->'rows')<>1 or e#>>'{rows,0,percent}' is null),
    'issueFingerprint',md5(coalesce(string_agg(key_hash||issues::text||value_hash,',' order by key_hash) filter(where cardinality(issues)>0),'')),
    'issues',coalesce(jsonb_agg(jsonb_build_object('keyHash',key_hash,'sourceRows',source_rows,'codes',issues,'matches',match_count) order by key_hash)
      filter(where cardinality(issues)>0),'[]')) audit from report;`;
}

export function assessContractAudit(report, { now = Date.now(), maxAgeMs = 30 * 60 * 1000 } = {}) {
  if (!report || report.schemaVersion !== 'contract-audit-v1' || !report.revision ||
    !Number.isInteger(report.sourceGroups) || report.sourceGroups < 1 || report.sourceGroups !== report.auditedGroups ||
    report.aligned + report.unresolved !== report.sourceGroups || !Array.isArray(report.issues) || report.issues.length !== report.unresolved) {
    return { level: 'UNVERIFIED', code: 'AUDIT_INCOMPLETE' };
  }
  const fetched = Date.parse(report.sourceFetchedAt), checked = Date.parse(report.databaseCheckedAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(checked) || now - fetched > maxAgeMs || now - checked > maxAgeMs ||
    fetched > now + 5 * 60 * 1000 || checked > now + 5 * 60 * 1000 || checked < fetched - 5 * 60 * 1000) {
    return { level: 'UNVERIFIED', code: 'AUDIT_STALE_OR_TIME_MISMATCH' };
  }
  return { level: report.unresolved ? 'ATTENTION' : 'VERIFIED', unresolved: report.unresolved,
    aligned: report.aligned, paymentNotCompared: report.paymentNotCompared,
    browserVerified: false, automaticWriterVerified: false };
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bundle = await readContractAuditSource();
    console.log(JSON.stringify({ ...bundle, evidence: undefined, readOnly: true }));
    if (process.argv.includes('--sql')) console.log(makeContractAuditSql(bundle));
  } catch (error) {
    console.log(JSON.stringify({ level: 'UNVERIFIED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'AUDIT_FAILED', readOnly: true }));
    process.exitCode = 1;
  }
}
