import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {crmRecentPremeetingRange as range,crmPlanRecentPremeetings as plan} from '../scripts/premeeting-sync-core.mjs';
const now='2026-09-15T08:00:00Z',hash=s=>createHash('sha256').update(s).digest('hex');
const row=(extra={})=>({ms_no:1,client_no:1,proj_no:1,client_rep_name:'업체',start_dt:'2026-09-15T01:00:00Z',end_dt:'2026-09-15T02:00:00Z',mr_type:1,mr_checked:0,...extra});
const apply=(state,p)=>{const x=structuredClone(state);x.leads.push(...structuredClone(p.mutation.collections.leads.upsert));for(const e of p.mutation.collections.leads.patches)for(const o of e.ops)x.leads.find(l=>l.id===e.id)[o.path[0]]=structuredClone(o.value);return x;};
test('KST three-day range crosses months and excludes all future and older schedules',()=>{
 assert.deepEqual(range('2026-09-30T15:00:00Z'),{start:'2026-09-29',end:'2026-10-01'});
 const p=plan([row(),row({ms_no:2,start_dt:'2026-09-12T14:00:00Z'}),row({ms_no:3,start_dt:'2026-09-15T15:00:00Z'}),row({ms_no:4,mr_type:2})],{leads:[]},now,hash);
 assert.equal(p.count,1);assert.equal(p.added,1);assert.equal(p.scheduled,1);assert.equal(p.completed,0);
});
test('unattended and manual use identical logic; repeated results create no patches or logs',()=>{
 const s={leads:[]},p=plan([row(),row({ms_no:2,mr_checked:1})],s,now,hash),a=apply(s,p);
 assert.equal(a.leads.length,1);assert.equal(a.leads[0].crmMeetings.length,2);assert.equal(a.leads[0].status,'프리미팅 완료');
 const next=plan([row(),row({ms_no:2,mr_checked:1})],a,now,hash);assert.equal(next.added+next.updated,0);assert.equal(next.mutation.collections.contractStatusLogs.upsert.length,0);
});
test('existing financial data, manual notes, completed state and old meetings survive',()=>{
 const l={id:'crm-1',projNo:1,status:'계약 완료',company:'사용자명',contractAmount:500,contractAt:'2026-08-01',paid:300,payments:[{id:'p',amount:300}],memo:'특이사항',salesOwner:'담당',crmMeeting:{msNo:9,type:1,startAt:'2026-08-01T00:00:00Z'},history:[]};
 const s={leads:[l]},a=apply(s,plan([row()],s,now,hash)).leads[0];
 for(const k of ['contractAmount','contractAt','paid','payments','memo','salesOwner','status','company'])assert.deepEqual(a[k],l[k]);
 assert.equal(a.crmMeetings.length,2);
});
test('strong identifiers avoid same-name merging; conflicting identifiers block writes',()=>{
 const s={leads:[{id:'crm-2',company:'업체',projNo:2}]};assert.equal(plan([row()],s,now,hash).added,1);
 const p=plan([row()],{leads:[{id:'crm-1',projNo:2},{id:'crm-2',projNo:1}]},now,hash);assert.equal(p.added+p.updated,0);assert.equal(p.blocked.length,1);
 assert.throws(()=>plan([row(),row({mr_checked:1})],{leads:[]},now,hash),/duplicate_conflict/);
});
const runtime=readFileSync(new URL('../scripts/daily-sync-runtime.gs',import.meta.url),'utf8');
function harness(){const values={},triggers=[];const s={_crmIso:()=>now,crmRecentPremeetingRange:range,crmPlanRecentPremeetings:plan,_crmHash:hash,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>values[k]||null,setProperty:(k,v)=>{values[k]=v}})},
 ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased(){return this},everyMinutes(n){assert.equal(n,5);return this},create(){triggers.push({getHandlerFunction:()=>name})}}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)},
 LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock:()=>{},releaseLock:()=>{}})},Utilities:{formatDate:()=> '9'}};
 vm.createContext(s);vm.runInContext(runtime,s);return {s,values,triggers};}
test('scheduler runs once, respects 9am, isolates failures, and never affects backup triggers',()=>{
 const {s,values,triggers}=harness();triggers.push({getHandlerFunction:()=> 'backup'});s.setupDailyTrigger();s.setupDailyTrigger();assert.equal(triggers.length,2);
 let calls=[];s._crmRunPremeetingSync=()=>{calls.push('pre');throw Error('offline')};s._crmRunSheetSync=()=>{calls.push('sheet');return {ok:true}};
 s.runPocketDailySync();assert.equal(calls.length,0);values.KPI_DAILY_ENABLED_FROM='2026-09-15';s.Utilities.formatDate=()=> '8';s.runPocketDailySync();assert.equal(calls.length,0);
 s.Utilities.formatDate=()=> '9';assert.throws(()=>s.runPocketDailySync(),/daily_sync_failed/);s.runPocketDailySync();assert.deepEqual(calls,['pre','sheet']);assert.equal(JSON.parse(values.KPI_SYNC_daily).ok,false);
});
test('today-success guard skips CRM API; preview does not store a success marker',()=>{
 const {s,values}=harness();let fetches=0;s._crmFetchRecentCalendar=()=>{fetches++;return [row()]};s._crmReadSupabasePrimaryEnvelope_=()=>({revision:'r',data:'{"leads":[]}'});
 s._crmRunPremeetingSync({dryRun:true});assert.equal(values.KPI_SYNC_premeeting,undefined);
 values.KPI_SYNC_premeeting=JSON.stringify({ok:true,date:'2026-09-15',range:range(now)});assert.equal(s._crmRunPremeetingSync({skipToday:true}).skipped,'already_successful_today');assert.equal(fetches,1);
});
test('revision conflict rebuilds calendar updates and preserves concurrent manual fields',()=>{
 const {s}=harness();let reads=0,saves=0;s._crmFetchRecentCalendar=()=>[row()];s._crmReadSupabasePrimaryEnvelope_=()=>({revision:'r'+(++reads),data:JSON.stringify({leads:[{id:'crm-1',company:'업체',status:'신규 DB',memo:reads>1?'새 메모':'기존',contractAmount:reads>1?999:0}]})});
 s._crmSaveMutationV2=b=>{saves++;for(const p of b.mutation.collections.leads.patches)assert.ok(!p.ops.some(o=>['memo','contractAmount'].includes(o.path[0])));return saves===1?{error:'revision_conflict'}:{ok:true,revision:'new'}};
 assert.equal(s._crmRunPremeetingSync({}).ok,true);assert.equal(reads,2);
});
test('trigger installation requires a one-time secret independent of the public app token',()=>{
 const {s}=harness();assert.equal(s._crmSetupDailyOnce({}).error,'forbidden');assert.equal(s._crmSetupDailyOnce({setupKey:'wrong'}).error,'forbidden');
 s.CRM_DAILY_SETUP_HASH=hash('test');assert.equal(s._crmSetupDailyOnce({setupKey:'test'}).triggerCount,1);assert.equal(s._crmSetupDailyOnce({setupKey:'test'}).error,'forbidden');
});
test('generated runtime and pure premeeting core equal the deployed source',()=>{
 const deployed=readFileSync(new URL('../../pocket-kpi-deploy/crm_lead.gs',import.meta.url),'utf8');new vm.Script(deployed);
 assert.equal(deployed.replace(/\r/g,''),(runtime+'\n/* BEGIN GENERATED PREMEETING CORE */\n'+readFileSync(new URL('../scripts/premeeting-sync-core.mjs',import.meta.url),'utf8').replace(/^export /gm,'')+'\n/* END GENERATED PREMEETING CORE */\n').replace(/\r/g,''));
});

test('DB/quality refresh cannot create meetings through retired broad-range or firstVisitAt paths',()=>{
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/await window\.crmFetchCheckedMeetings\(/);
 assert.doesNotMatch(source,/var (?:new)?[Cc]alendarDate =/);
 assert.match(source,/refreshContractReview\(false, false\)/);
 assert.doesNotMatch(source,/setInterval\([^\n]*refreshContractReview/);
});

test('idempotent manual sync recovers once after lost Apps Script redirect; never retries unsafe writes',async()=>{
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  function crmPostSheetAction('),source.indexOf('  window.crmFetchContractSheetChanges'));
 let calls=0;
 const s={CRM_SHEET_URL:'https://example.invalid',CRM_TOKEN:'test',fetch:async()=>++calls===1?{ok:false,status:404}:{ok:true,json:async()=>({ok:true})},setTimeout,clearTimeout,crmDelay:async()=>{}};
 vm.createContext(s);vm.runInContext(fn,s);
 assert.equal((await s.crmPostSheetAction('premeeting_sync',{})).ok,true);assert.equal(calls,2);
 calls=0;await assert.rejects(s.crmPostSheetAction('save_mutation_v2',{}),/sheet_404/);assert.equal(calls,1);
 calls=0;s.fetch=async()=>{calls++;return {ok:true,json:async()=>({error:'permission_denied'})}};
 await assert.rejects(s.crmPostSheetAction('contract_auto_sync',{}),/permission_denied/);assert.equal(calls,1);
});
