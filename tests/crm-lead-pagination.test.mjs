import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../supabase/functions/kpi-domain-api/index.ts',import.meta.url),'utf8');
const fn=stripTypeScriptTypes(source.slice(source.indexOf('async function readScopeLeads'),source.indexOf('function buildMarketing')));
const read=vm.runInNewContext(fn+'readScopeLeads');
function client(n,{errorPage,mixedRevision=false,changedCount=false,truncated=false}={}){
  const pages=[];const c={from(table){assert.equal(table,'leads');const orders=[];
    const q={select(cols,opts){assert.equal(opts.count,'exact');return q;},eq(k,v){assert.equal(k,'organization_id');assert.equal(v,'synthetic-org');return q;},
      is(k,v){assert.equal(k,'archived_at');assert.equal(v,null);return q;},order(k){orders.push(k);return q;},async range(a,b){
        assert.deepEqual(orders,['created_at','id']);assert.equal(b-a,499);pages.push(a);
        return {data:Array.from({length:Math.min(truncated?250:500,Math.max(0,n-a))},(_,i)=>({source_payload:{id:`synthetic-${a+i}`},projected_revision:mixedRevision&&a>0?'new':'old'})),
          count:n+(changedCount&&a>0?1:0),error:errorPage===a?{code:'TEST'}:null};
      }};return q;}};return {c,pages};
}
for(const n of [0,999,1000,1034])test(`complete authorized CRM read returns all${n} rows`,async()=>{
  const h=client(n);const r=await read(h.c,'synthetic-org',false,true);
  assert.equal(r.error,null);assert.equal(r.data.length,n);
  if(n===1034)assert.equal(r.data[1032].source_payload.id,'synthetic-1032');
  if(n===1000)assert.deepEqual(h.pages,[0,500]); // Avoid an out-of-bounds REST range at an exact page boundary.
});
for(const option of [{errorPage:500},{mixedRevision:true},{changedCount:true},{truncated:true}])test(`incomplete/mixed read does not return partial success:${JSON.stringify(option)}`,async()=>{
  const h=client(1034,option);const r=await read(h.c,'synthetic-org',false,true);
  assert.equal(r.data,null);assert.ok(r.error.code);
});

test('same-revision1000-row cache is rebuilt when authorized count is1034',async()=>{
  const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8').replace(/\r/g,'');
  const a=main.indexOf('  async function crmFetchDomainState()');const b=main.indexOf('\n\n  window.fetchCrmSheetState',a);
  const values={cache:JSON.stringify({leads:Array.from({length:1000},(_,i)=>({id:String(i)}))}),rev:'r'};
  let bootstraps=0;
  const s={window:{},CRM_LOCAL_STATE_KEY:'cache',CRM_REMOTE_REVISION_KEY:'rev',CRM_LOCAL_DIRTY_KEY:'dirty',localStorage:{getItem:k=>values[k]},
    crmApplyRemoteEnvelope:()=>{},crmApplyMarketingEnvelope:()=>{},crmFetchDomainAction:async action=>{
      if(action==='meta')return {revision:'r'};
      if(action==='bootstrap'){bootstraps++;return {documents:{},revision:'r'};}
      return {leads:Array.from({length:1034},(_,i)=>({id:String(i)})),calendar:[],leadReadVerification:{verified:true,count:1034}};
    }};
  vm.createContext(s);vm.runInContext(main.slice(a,b)+'globalThis.load=crmFetchDomainState;',s);
  const result=await s.load();assert.equal(bootstraps,1);assert.equal(result.unchanged,undefined);
  assert.equal(JSON.parse(result.value).leads.length,1034);
});
