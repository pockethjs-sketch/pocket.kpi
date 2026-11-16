import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { premeetingWindow, collectPremeetingPages } from '../supabase/functions/_shared/premeeting-window.mjs';
import { isPremeetingReadLead, validatePremeetingMutation } from '../supabase/functions/_shared/premeeting-access.mjs';

test('scheduled HMAC expands only calendar through month-end, ordinary staff reads do not write', () => {
  assert.deepEqual(premeetingWindow('2026-11-14','2026-11-16','2026-11-16',false), {project:true,start:'2026-11-01',end:'2026-11-30'});
  assert.equal(premeetingWindow('2026-11-14','2026-11-16','2026-11-16',true).project,false);
  assert.equal(premeetingWindow('2026-11-14','2026-11-16','2026-11-16',true,true).project,true);
  assert.equal(premeetingWindow('2028-02-27','2028-02-29','2028-02-29',false).end,'2028-02-29');
});
test('all schedule pages including unconfirmed and distinct IDs are retained', async () => {
  const offsets=[];
  const records=await collectPremeetingPages('https://example.invalid',{},async url=>{
    const offset=Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
    return new Response(JSON.stringify(offset===0?[{ms_no:1,mr_checked:0},{ms_no:2,mr_checked:0}]:[]));
  },x=>x);
  assert.deepEqual(offsets,[0,500]); assert.equal(records.length,2);
});
test('repeated/capped pages and missing identities fail instead of silently completing',async()=>{
  for(const row of [{ms_no:1},{}]) await assert.rejects(collectPremeetingPages('https://example.invalid',{},async()=>new Response(JSON.stringify([row])),x=>x), /calendar_page_repeated|calendar_identity_invalid/);
});
test('schedule membership affects reads but does not widen limited employee mutation rights',()=>{
  const lead={id:'synthetic',status:'드랍',crmMeetings:[{msNo:1,type:1,startAt:'2026-11-24T10:00:00+09:00'}]};
  assert.equal(isPremeetingReadLead(lead),true);
  assert.equal(isPremeetingReadLead({...lead,archivedAt:'2026-11-01'}),false);
  assert.equal(isPremeetingReadLead({id:'unrelated',status:'신규 DB'}),false);
  assert.equal(validatePremeetingMutation({collections:{leads:{patches:[{id:lead.id,ops:[{op:'set',path:['expected'],value:1}]}]}}},[lead]),false);
});
test('actual company predicate includes future/unconfirmed and manually dropped schedules without unrelated leads',()=>{
  const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('const STATUSES ='),source.indexOf('const SSTYLE ='));
  const ctx={inR:(d,r)=>!!d&&d>=r[0]&&d<=r[1]}; vm.createContext(ctx);
  vm.runInContext(body+';globalThis.matches=isPremeetingCompanyInRange',ctx);
  for(const status of ['신규 DB','TM 진행중','드랍']) {
    assert.equal(ctx.matches({status,crmMeetings:[{type:1,startAt:'2026-11-24T01:00:00Z'}]},['2026-11-01','2026-11-30']),true);
    assert.equal(ctx.matches({status,createdAt:'2026-11-24'},['2026-11-01','2026-11-30']),false);
  }
});
test('fresh projector binds exact run/window/count and preserves private financial-safe commit',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261116021000_fresh_month_premeeting_projection.sql',import.meta.url),'utf8');
  for(const expected of ['security invoker','sync_run_id=p_sync_run_id','15 minutes','premeeting_source_membership_mismatch','stored_premeeting_sync','commit_primary_mutation','from public,anon,authenticated']) assert.ok(sql.includes(expected));
  assert.doesNotMatch(sql,/security definer|private\.project_v3_state|delete from public|update public\.(deals|payment_|accounts)/i);
});
