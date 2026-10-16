import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { verifyCalendarConsistency } from '../supabase/functions/_shared/calendar-consistency.mjs';

const source = readFileSync(new URL('../supabase/functions/kpi-crm-sync/index.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source.replace(/^import .*\r?\n/gm, ''));
function harness({ leads = [], meetings = [], daily = false, projectionError = false, projectionMismatch = false, calendarMismatch = false, aggregationMismatch = false, aggregationReadError = false, rpcError = false, blocked = false, completionError = false, invalid = false, rawError = false } = {}) {
  const calls = []; let handler;
  let rawRows = [];
  const client = {
    from(table) { return {
      insert() { return { select() { return { single: async () => ({data:{id:'synthetic-run'},error:null}) }; } }; },
      async upsert(rows) { rawRows.push(...rows); calls.push('raw'); return {error:rawError ? {code:'TEST'} : null}; },
      select(columns) { const aggregate = columns.includes('payload'); const chain = { eq() { return chain; }, order() { return chain; }, async range() {
        calls.push(aggregate ? 'aggregation' : 'calendar'); return { data: calendarMismatch ? [] : rawRows.filter(row => row.record_type === 'MEETING'), error: aggregate && aggregationReadError ? {code:'TEST'} : null };
      } }; return chain; },
      update(value) { return { async eq() { calls.push(value.status); return {error:completionError && value.status==='COMPLETED' ? {code:'TEST'} : null}; } }; },
    }; },
    async rpc(name,args) {
      if(name==='kpi_reconcile_crm_premeetings') {
        calls.push('companyProjection'); assert.equal(args.p_start,'2026-10-05');assert.equal(args.p_end,'2026-10-07');assert.equal(args.p_dry_run,false);
        return {data:{ok:true,verified:!projectionMismatch,blocked:0,stored:meetings.length},error:projectionError ? {code:'TEST'} : null};
      }
      calls.push('promote'); assert.equal(name,'kpi_reconcile_crm_inflow');
      assert.equal(args.p_dry_run,false); assert.equal(args.p_start,'2026-09-30');
      return {data:{ok:!blocked,blocked:blocked ? 1 : 0,added:leads.length},error:rpcError ? {code:'TEST'} : null};
    },
  };
  vm.runInNewContext(js, {
    TextEncoder, Response, crypto:webcrypto, createClient:()=>client,
    Date:class extends Date {constructor(...args){super(...(args.length ? args : ['2026-10-07T01:00:00Z']));}static now(){return Date.parse('2026-10-07T01:00:00Z');}},
    verifyCalendarConsistency: (raw, options) => ({...verifyCalendarConsistency(raw, options), ...(aggregationMismatch ? {verified:false} : {})}),
    Deno:{env:{get:name=>({KPI_SHADOW_HMAC_SECRET:'synthetic-hmac-only',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',CRM_BEARER_TOKEN:'synthetic-provider',KPI_ORGANIZATION_ID:'synthetic-org',SUPABASE_URL:'https://example.invalid'})[name]},serve:fn=>{handler=fn;}},
    fetch:async url=>new Response(JSON.stringify(url.includes('newarrivals') ? invalid ? {error:'bad'} : leads : meetings)),
  });
  return {calls, invoke:async()=>{
    const body=JSON.stringify({start:'2026-10-05',end:'2026-10-07'});
    const headers={authorization:'Bearer synthetic-only'};
    if(daily){
      delete headers.authorization;
      headers['x-kpi-timestamp']=String(Date.parse('2026-10-07T01:00:00Z'));
      const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-hmac-only'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      headers['x-kpi-signature']=Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(headers['x-kpi-timestamp']+'.'+body))).toString('hex');
    }
    return handler(new Request('https://example.invalid',{method:'POST',headers,body}));
  }, handler};
}

test('daily HMAC collection cannot complete before company-list projection verification',async()=>{
  const h=harness({daily:true});const r=await h.invoke();assert.equal(r.status,200);
  assert.deepEqual(h.calls,['calendar','aggregation','promote','companyProjection','COMPLETED']);
  assert.equal((await r.json()).calendar.companyProjection.verified,true);
});
for(const option of ['projectionError','projectionMismatch'])test(`daily collection fails after ${option}`,async()=>{
  const h=harness({daily:true,[option]:true});const r=await h.invoke();assert.equal(r.status,502);
  assert.ok(!h.calls.includes('COMPLETED'));assert.equal(h.calls.at(-1),'FAILED');
  assert.match((await r.json()).message,/^premeeting_/);
});
test('server reconciles raw leads before recording collection success',async()=>{
  const h=harness({leads:[{client_no:1,proj_no:2,reg_dt:'2026-10-06T01:00:00Z'}]});
  const r=await h.invoke(); assert.equal(r.status,200); assert.deepEqual(h.calls,['raw','calendar','aggregation','promote','COMPLETED']);
  assert.equal((await r.json()).inflow.added,1);
});
test('empty daily feed still reconciles the previously collected backlog',async()=>{
  const h=harness(); assert.equal((await h.invoke()).status,200); assert.deepEqual(h.calls,['calendar','aggregation','promote','COMPLETED']);
});

test('daily update separately verifies CRM premeeting schedules, not only inflow leads', async () => {
  const h = harness({ meetings: [{ ms_no: 101, mr_type: 1, start_dt: '2026-10-07T10:00:00+09:00', mr_checked: 0 }] });
  const response = await h.invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.calendar.verified, true);
  assert.equal(body.calendar.collected, 1);
  assert.equal(body.calendar.stored, 1);
  assert.equal(body.calendar.aggregation.verified, true);
  assert.equal(body.calendar.aggregation.source.total, 1);
  assert.equal(body.calendar.aggregation.screen.total, 1);
  assert.equal(body.calendar.aggregation.screen.daily['2026-10-07'], 1);
  const bad = harness({ calendarMismatch: true, meetings: [{ ms_no: 101, mr_type: 1, start_dt: '2026-10-07' }] });
  assert.equal((await bad.invoke()).status, 502);
  assert.ok(!bad.calls.includes('COMPLETED'));
});
for(const option of ['rpcError','blocked','completionError','invalid','rawError','aggregationMismatch','aggregationReadError']) {
  test(`sync never reports success after ${option}`,async()=>{
    const h=harness({[option]:true,leads:[{client_no:1,reg_dt:'2026-10-06'}]});
    const r=await h.invoke(); assert.equal(r.status,502); assert.equal(h.calls.at(-1),'FAILED');
    if(option!=='completionError') assert.ok(!h.calls.includes('COMPLETED'));
    if(['invalid','rawError','aggregationMismatch','aggregationReadError'].includes(option)) assert.ok(!h.calls.includes('promote'));
    assert.match((await r.json()).message,/^[a-zA-Z0-9_]+$/);
  });
}
test('server-only reconciliation keeps unauthorized requests closed',async()=>{
  const h=harness(); const r=await h.handler(new Request('https://example.invalid',{method:'POST',body:'{}'}));
  assert.equal(r.status,401); assert.deepEqual(h.calls,[]);
});
test('database reconciliation is invoker-only and does not grant browser execution',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261007013617_crm_inflow_server_reconciliation.sql',import.meta.url),'utf8');
  assert.match(sql,/language plpgsql security invoker/);
  assert.match(sql,/from public, anon, authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/inflow_projection_mismatch/);
  assert.match(sql,/array\['createdAt','calendarOnly','crmSheet','channel'\]/);
});
