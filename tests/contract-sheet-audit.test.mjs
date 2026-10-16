import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContractCsv, contractAuditEvidence, readContractAuditSource, makeContractAuditSql, assessContractAudit } from '../scripts/contract-sheet-audit.mjs';
const now = '2026-10-16T04:00:00Z';
const header = ['날짜','업체명','프리','프로젝트','별도가','비고','신규/기존','대금 지급 확인','입금확인 업로드'];
const csv = row => [header.join(','),row.join(',')].join('\r\n');
const sample = (extra={}) => ({ schemaVersion:'contract-audit-v1',revision:'synthetic-r1',sourceGroups:1,auditedGroups:1,aligned:1,unresolved:0,paymentNotCompared:0,issues:[],sourceFetchedAt:new Date().toISOString(),databaseCheckedAt:new Date().toISOString(),...extra });

test('audit CSV handles BOM, escaped quotes, commas, CRLF and quoted newlines',()=>{
  const rows=parseContractCsv('\uFEFFa,b\r\n"x,y","a""b\nc"\r\n');
  assert.deepEqual(rows,[['a','b'],['x,y','a"b\nc']]);
  assert.throws(()=>parseContractCsv('a,b\n"unfinished'),/SOURCE_CSV_TRUNCATED/);
});
test('source evidence reuses H check/percentage and O VAT semantics without retaining names or notes',()=>{
  const text=csv(['26-10-12','가상 검증 업체','가상 담당','투A(V2)','380','개인 메모 원문','신규','✓','✓']);
  const result=contractAuditEvidence(text,{now});
  assert.equal(result.evidence[0].amount,4180000);
  assert.equal(result.evidence[0].rows[0].percent,100);
  assert.equal(result.evidence[0].rows[0].proof,true);
  const encoded=JSON.stringify(result);
  for(const raw of ['가상 검증 업체','가상 담당','개인 메모 원문','투A']) assert.ok(!encoded.includes(raw));
  const partial=contractAuditEvidence(csv(['26-10-12','테스트 업체','','투A','380','','신규','20%','✓']),{now});
  assert.equal(partial.evidence[0].rows[0].percent,20);
});
test('proof uploaded alone is not promoted to a full payment',()=>{
  const bundle=contractAuditEvidence(csv(['26-10-12','테스트 업체','','투A','380','','신규','','✓']),{now});
  assert.equal(bundle.evidence[0].rows[0].percent,null);
  assert.equal(bundle.evidence[0].rows[0].proof,true);
  assert.match(makeContractAuditSql(bundle),/PROOF_WITHOUT_PAYMENT_STATUS/);
});
test('empty data, wrong or duplicated headers, and no rows in approved date range fail closed',()=>{
  assert.throws(()=>contractAuditEvidence('a,b\n1,2',{now}),/SOURCE_HEADERS/);
  assert.throws(()=>contractAuditEvidence(csv(['26-08-01','업체','','투A','380','','신규','✓','']),{now}),/SOURCE_NO_ROWS_IN_RANGE/);
  assert.throws(()=>contractAuditEvidence('a,b',{now}),/SOURCE_NO_ROWS/);
  const duplicate=csv(['26-10-12','업체','','투A','380','','신규','✓','']).replace('별도가','날짜');
  assert.throws(()=>contractAuditEvidence(duplicate,{now}),/SOURCE_HEADERS/);
});
test('HTTP errors, login HTML, redirects and body failures never become a healthy zero',async()=>{
  for(const response of [new Response('denied',{status:403}),new Response('<html>login</html>',{headers:{'content-type':'text/html'}})]) {
    await assert.rejects(readContractAuditSource({now,fetchImpl:async()=>response}),/SOURCE_UNAVAILABLE/);
  }
  await assert.rejects(readContractAuditSource({now,fetchImpl:async()=>{throw Error('private access details')}}),/SOURCE_UNAVAILABLE/);
});
test('authenticated connections are not required for user-approved public source and SQL is read only',async()=>{
  let seen;
  const bundle=await readContractAuditSource({now,fetchImpl:async(url,opts)=>{
    seen={url,opts};return new Response(csv(['26-10-12','테스트 업체','','투A','380','','신규','✓','✓']),{headers:{'content-type':'text/csv'}});
  }});
  assert.ok(seen.url.endsWith('/export?format=csv&gid=0'));
  assert.equal(seen.opts.headers,undefined);
  const sql=makeContractAuditSql(bundle);
  assert.doesNotMatch(sql,/\b(?:insert|update|delete|create|alter|grant|commit_primary_mutation)\b/i);
  assert.doesNotMatch(sql,/테스트 업체/);
  for(const code of ['CONTRACT_DATE_MISMATCH','CONFIRMED_PAYMENT_MISMATCH','RELATIONAL_SNAPSHOT_MISMATCH','SCHEDULE_TOTAL_MISMATCH','AMBIGUOUS','UNMATCHED']) assert.ok(sql.includes(code));
  assert.ok(sql.includes("regexp_matches(raw,'\\(([^)]+)\\)','g')"));
});
test('missing evidence and incomplete queries cannot pass; unresolved never reports VERIFIED',()=>{
  assert.throws(()=>makeContractAuditSql({}),/AUDIT_EVIDENCE_INVALID/);
  for(const r of [null,sample({revision:null}),sample({auditedGroups:0}),sample({sourceGroups:0}),sample({unresolved:1})]) assert.equal(assessContractAudit(r).level,'UNVERIFIED');
  const attention=assessContractAudit(sample({aligned:0,unresolved:1,issues:[{codes:['AMBIGUOUS']}]}));
  assert.equal(attention.level,'ATTENTION');
  const valid=assessContractAudit(sample());
  assert.equal(valid.level,'VERIFIED');assert.equal(valid.browserVerified,false);assert.equal(valid.automaticWriterVerified,false);
});
test('multiple dates and future contracts remain visible for review, not silently summed into an existing record',()=>{
  const text=[header.join(','),['26-09-01','테스트 업체','','투A','380','','신규','✓','✓'].join(','),['26-11-01','테스트 업체','','투A','380','','기존','',''].join(',')].join('\n');
  const b=contractAuditEvidence(text,{now});assert.equal(b.evidence[0].rows.length,2);
  const sql=makeContractAuditSql(b);assert.match(sql,/MULTIPLE_SOURCE_CONTRACTS/);assert.match(sql,/FUTURE_SOURCE_CONTRACT/);
});
test('stale reports and clock/snapshot mismatch are not verified',()=>{
  assert.equal(assessContractAudit(sample({sourceFetchedAt:'2026-01-01T00:00:00Z'})).level,'UNVERIFIED');
  assert.equal(assessContractAudit(sample({databaseCheckedAt:'not-a-date'})).level,'UNVERIFIED');
  assert.equal(assessContractAudit(sample({sourceFetchedAt:new Date(Date.now()+3600000).toISOString()})).level,'UNVERIFIED');
});
test('a populated row with an invalid or missing date cannot silently disappear',()=>{
  for(const date of ['26-99-99','']) assert.throws(()=>contractAuditEvidence(csv([date,'테스트 업체','','투A','380','','신규','✓','✓']),{now}),/SOURCE_(?:ROW_DATE_INVALID|NO_ROWS_IN_RANGE)/);
});
