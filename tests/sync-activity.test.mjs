import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {syncActivityRows,filterSyncActivity,syncChanges,formatSyncValue} from '../src/data/syncActivity.mjs';
const now='2026-09-15T08:00:00Z';
const log=(id,extra={})=>({id,leadId:'lead-'+id,company:'업체 '+id,at:now,action:'CRM 동기화',meta:{previousStatus:'미등록',nextStatus:'프리미팅 확정'},...extra});

test('only recorded auto-applied changes are included; manual entries, exclusions and failures are not',()=>{
 const source=[log('1'),log('2',{action:'외부 시트 자동 반영'}),log('3',{action:'직접 추가'}),log('4',{action:'외부 시트 생성'}),log('5',{action:'외부 시트 제외'}),log('6',{status:'FAILED'}),log('7',{action:'조회 완료'}),null];
 const snapshot=JSON.stringify(source),rows=syncActivityRows(source);
 assert.deepEqual(rows.map(r=>r.id),['1','2']);assert.equal(JSON.stringify(source),snapshot);
});
test('duplicate IDs are shown once without collapsing multiple legitimate updates for the same company',()=>{
 const a=log('1'),b=log('2',{leadId:a.leadId,at:'2026-09-15T08:10:00Z'}),rows=syncActivityRows([a,a,b]);
 assert.deepEqual(rows.map(r=>r.id),['2','1']);assert.equal(new Set(rows.map(r=>r.leadId)).size,1);
});
test('filters use KST sync time, not contract/meeting date or selected month',()=>{
 const rows=syncActivityRows([log('1',{at:'2026-09-14T15:01:00Z',date:'2026-08-01'}),log('2',{at:'2026-09-14T14:59:00Z'}),log('3',{at:'2026-09-08T15:00:00Z'}),log('4',{at:'2026-09-08T14:59:00Z'}),log('5',{at:'2026-09-15T15:00:00Z'})]);
 assert.deepEqual(filterSyncActivity(rows,{days:'1',now}).map(r=>r.id),['1']);
 assert.deepEqual(filterSyncActivity(rows,{days:'7',now}).map(r=>r.id),['1','2','3']);
});
test('source, created/updated and search filters compose correctly; missing lead does not erase history',()=>{
 const rows=syncActivityRows([log('1',{company:'회사알파',action:'외부 시트 자동 반영',meta:{before:{contractAmount:0},after:{contractAmount:5500000}}}),log('2')]);
 assert.equal(filterSyncActivity(rows,{source:'sheet',result:'updated',query:'알파',now}).length,1);
 assert.equal(filterSyncActivity(rows,{result:'created',now}).length,1);
 assert.equal(filterSyncActivity(rows,{query:'없는이름',now}).length,0);
});
test('only stored before/after values are displayed; zero money is not missing and no current-value inference',()=>{
 const row=log('1',{meta:{before:{contractAmount:0,status:'프리미팅 완료',memo:'기존',buildup:'동일'},after:{contractAmount:5500000,status:'계약 완료',memo:'추가',buildup:'동일'}}});
 assert.deepEqual(syncChanges(row).map(c=>c.key),['contractAmount','status','memo']);
 assert.equal(formatSyncValue('contractAmount',0),'0원');assert.equal(formatSyncValue('contractAmount',5500000),'5,500,000원');
 assert.deepEqual(syncChanges(log('2',{meta:{}})),[]);
});
test('confirmed H-column payment is visible as a monetary sync change without inventing a date',()=>{
 const row=log('payment',{action:'외부 시트 자동 반영',detail:'H열 입금 완료 확인',meta:{before:{paid:0,paidConfirmed:false},after:{paid:5500000,paidConfirmed:true}}});
 assert.deepEqual(syncChanges(row).map(c=>c.key),['paid','paidConfirmed']);
 assert.equal(formatSyncValue('paid',5500000),'5,500,000원');
 assert.equal(formatSyncValue('paidConfirmed',true),'완료');
 assert.equal(filterSyncActivity(syncActivityRows([row]),{source:'sheet',now}).length,1);
});
test('legacy date-only logs have no invented exact timestamp; unknown time is available only in all history',()=>{
 const rows=syncActivityRows([log('1',{at:'2026-09-15'}),log('2',{at:''})]);
 assert.ok(rows.every(r=>r.time===0));assert.equal(filterSyncActivity(rows,{now}).length,0);assert.equal(filterSyncActivity(rows,{days:'all',now}).length,2);
});
test('new tab loads stored logs via read-only bootstrap and never triggers source synchronization',()=>{
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),component=readFileSync(new URL('../src/RecentSyncActivity.jsx',import.meta.url),'utf8');
 const loader=source.slice(source.indexOf('window.crmFetchSyncActivity ='),source.indexOf('  function crmPostSheetAction'));
 assert.match(loader,/crmFetchDomainAction\('bootstrap'\)/);assert.doesNotMatch(loader,/method: 'POST'|crmSync|setDb/);
 assert.doesNotMatch(component,/crmPostSheetAction|crmSyncRecentPremeetings|crmSyncNewContracts|setDb|localStorage/);
 assert.match(source,/aria-controls=\{'deals-panel-'/);
});
