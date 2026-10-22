import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultContractReviewMonth,contractReviewMonthLabel,filterContractReviewMonth,contractReviewMonthOptions} from '../src/data/contractReviewMonth.js';

const item=(id,date)=>({id,firstDate:date,sourceRows:[{date}],targetId:'existing-record',sourceAmount:5500000});
const items=[item('oct','2026-10-04'),item('sep','2026-09-06'),item('last-year','2025-10-01'),item('invalid','2026-02-30')];

test('opening defaults to selected KPI month/day, otherwise current month without changing page period',()=>{
 const period={mode:'month',y:2026,m:9};
 assert.equal(defaultContractReviewMonth(period,'2026-10-22'),'2026-09');
 assert.deepEqual(period,{mode:'month',y:2026,m:9});
 assert.equal(defaultContractReviewMonth({mode:'day',y:2026,m:8},'2026-10-22'),'2026-08');
 for(const mode of ['year','range','all'])assert.equal(defaultContractReviewMonth({mode,y:2025,m:8},'2026-10-22'),'2026-10');
 assert.equal(defaultContractReviewMonth({mode:'month',y:2026,m:13},'2026-10-22'),'2026-10');
});

test('filter is year-qualified source A contract month, not meeting or paid month; items remain unchanged',()=>{
 const input=structuredClone(items);input[0].premeetingAt='2026-09-01';input[0].paidAt='2026-08-01';
 const before=structuredClone(input),visible=filterContractReviewMonth(input,'2026-10');
 assert.deepEqual(visible.map(x=>x.id),['oct']);assert.strictEqual(visible[0],input[0]);assert.equal(visible[0].targetId,'existing-record');assert.deepEqual(input,before);
 assert.equal(filterContractReviewMonth(input,'2026-08').length,0);
 assert.equal(filterContractReviewMonth(input,'all').length,4);
 assert.deepEqual(filterContractReviewMonth(input,'unknown').map(x=>x.id),['invalid']);
});

test('all source months of a held legacy group remain discoverable without splitting the contract',()=>{
 const group={id:'held',firstDate:'2026-08-01',sourceRows:[{date:'2026-08-01'},{date:'2026-10-01'}],reviewReason:'multiple dates'};
 assert.strictEqual(filterContractReviewMonth([group],'2026-10')[0],group);
 assert.equal(filterContractReviewMonth([group],'2026-10')[0].sourceRows.length,2);
});

test('month menu includes zero-result months, selected outside range, source months, all and invalid-date holds',()=>{
 const options=contractReviewMonthOptions(items,{start:'2026-08-01',today:'2026-10-22',selected:'2026-07'});
 assert.equal(options[0].label,'전체 기간 · 4건');
 assert.equal(options.find(x=>x.value==='2026-08').label,'2026년 8월 · 0건');
 assert.ok(options.some(x=>x.value==='2026-07'));assert.ok(options.some(x=>x.value==='2025-10'));
 assert.equal(options.at(-1).value,'unknown');assert.equal(options.at(-1).label,'날짜 확인 필요 · 1건');
 const boundary=contractReviewMonthOptions([],{start:'2025-12-01',today:'2026-02-01',selected:'2026-01'});
 assert.deepEqual(boundary.map(x=>x.value),['all','2026-02','2026-01','2025-12']);
 assert.equal(contractReviewMonthLabel('2026-10'),'2026년 10월');
});

test('month selection is presentation-only: change handler never reads source or writes records; refresh does not reset month',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/aria-label="시트 계약 조회 월" value=\{contractReviewMonth\} onChange=\{e => setContractReviewMonth\(e.target.value\)\}/);
 assert.equal((main.match(/setContractReviewMonth\(defaultContractReviewMonth\(period, todayISO\(\)\)\); setContractReviewOpen\(true\); refreshContractReview\(true, false\)/g)||[]).length,2);
 const start=main.indexOf('  const refreshContractReview = async'),end=main.indexOf('  useEffect(',start);
 assert.doesNotMatch(main.slice(start,end),/setContractReviewMonth/);
});
