import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseContractHistory,HISTORY_SHEET_ID} from '../scripts/contract-history-parser.mjs';
import {buildMonthlyPerformance,monthDifference} from '../src/contract-performance.mjs';
const source={spreadsheetId:HISTORY_SHEET_ID,performance:[[, '2026 포켓컴퍼니 전체 성과'],[, '4월',100,0,0,0,0,3,0,0,0,600]],contracts:[
  [, '2026년 4월 계약 리스트'],[,, '담당A',,,,, '담당B'],[],
  [,1,'가','홈페이지','A','투 A',200,'나','INSTA','B','정 B',400],
  [,'계약 수','1개',,,,200,'2개',,,,400],
  [,'당월 마케팅 매출액',600],[,'추가계약 포함 매출',600],
]};
const history=parseContractHistory(source);
const valueOf=l=>l.contractAmount;
const leads=[{id:'overlap',status:'계약 완료',contractAt:'2026-04-01',contractAmount:99},
  {id:'new',status:'계약 완료',contractAt:'2026-07-02',contractAmount:200,ctype:'신규',salesOwner:'담당A'},
  {id:'existing',status:'계약 완료',contractAt:'2026-07-02',contractAmount:300,ctype:'기존',salesOwner:'담당B'},
  {id:'undated',status:'계약 완료',contractAt:'',contractAmount:999},
  {id:'not-signed',status:'견적 발송',contractAt:'2026-07-01',contractAmount:999}];
test('history preserves reported counts separately from detail rows without inventing customer types or receipts',()=>{
  assert.equal(history.months.length,1);assert.equal(history.details.length,2);assert.equal(history.months[0].reported_count,3);
  assert.equal(history.details[0].source_cell,'C4');assert.equal(history.details[1].grade,'B');
  assert.ok(history.details.every(r=>r.customer_type===null&&!('paidAt' in r)&&!('contractAt' in r)));
  assert.deepEqual(parseContractHistory(source),history);
});
test('history takes precedence for overlapping months, without changing CRM data',()=>{
  const before=JSON.stringify(leads);const months=buildMonthlyPerformance(leads,history,'전체',valueOf);
  assert.equal(months[0].amount,600);assert.equal(months[0].overlapCount,1);assert.equal(months[0].count,3);
  assert.equal(months[0].owners['담당B'].count,1);assert.equal(months[1].amount,500);assert.equal(months.length,2);
  assert.equal(JSON.stringify(leads),before);
});
test('unknown historical classifications show unavailable rather than zero; live types still filter',()=>{
  for(const [type,amount] of [['신규',200],['기존',300]]){
    const months=buildMonthlyPerformance(leads,history,type,valueOf);
    assert.equal(months[0].amount,null);assert.equal(months[0].count,null);assert.equal(months[1].amount,amount);
  }
});
test('summary-only months do not get invented owners or details',()=>{
  const h=parseContractHistory({...source,contracts:[]});const m=buildMonthlyPerformance(leads,h,'전체',valueOf)[0];
  assert.equal(m.amount,600);assert.equal(m.hasDetails,false);assert.deepEqual(m.owners,{});
});
test('changes require contiguous months, nonzero denominator and comparable accounting basis',()=>{
  const m=(month,amount)=>({month,amount,source:'crm',count:1});
  assert.equal(monthDifference(m('2026-07',200),m('2026-06',100)),100);
  assert.equal(monthDifference(m('2026-07',200),m('2026-05',100)),null);
  assert.equal(monthDifference(m('2026-07',200),m('2026-06',0)),null);
  assert.equal(monthDifference(m('2026-07',200),{...m('2026-06',100),source:'sheet',record:{list_total_amount:null}}),null);
});
test('import writes only separate history tables and source conflicts abort instead of overwrite',()=>{
  const script=readFileSync(new URL('../scripts/import-contract-history.mjs',import.meta.url),'utf8');
  assert.match(script,/history_conflict/);assert.match(script,/do nothing/);assert.doesNotMatch(script,/update public\.(leads|deals|app_current_state)/);
  const sql=readFileSync(new URL('../supabase/migrations/20260915021309_contract_performance_history.sql',import.meta.url),'utf8');
  for(const table of ['months','owners','details'])assert.ok(sql.includes(`alter table public.contract_history_${table} enable row level security`));
  assert.match(sql,/from public, anon, authenticated/);
});
