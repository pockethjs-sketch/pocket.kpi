import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePremeetingMutation as valid, premeetingDocuments, canAccessAction } from '../supabase/functions/_shared/premeeting-access.mjs';
import { accountFromEmployeeAccess } from '../src/data/employeeAccount.js';
import { preparePremeetingState } from '../src/data/premeetingState.js';
const leads = [{id:'a',status:'프리미팅 완료'}, {id:'b',status:'신규 DB'}, {id:'c',status:'계약 완료',archived_at:'2026-01-01'}];
const patch = (id, path=['expected'], value=100) => ({collections:{leads:{patches:[{id,ops:[{op:'set',path,value}]}]}}});
test('limited account has exactly one page; unrelated data never enters its UI defaults', () => {
  assert.deepEqual(accountFromEmployeeAccess({userId:'x',role:'EDITOR',scope:'premeeting'},['marketing','settings']).allowedPages,['deals']);
  const scoped = preparePremeetingState({leads:[leads[0]],marketingLogs:[{id:'secret'}],adSpend:{secret:100},settings:{apiKey:'synthetic'}});
  assert.equal(scoped.leads.length,1); assert.deepEqual(scoped.marketingLogs,[]); assert.deepEqual(scoped.adSpend,{}); assert.deepEqual(scoped.settings,{});
});
test('scope includes edit/new premeeting, denies other and archived lead writes', () => {
  assert.equal(valid(patch('a'),leads),true);
  assert.equal(valid(patch('b'),leads),false);
  assert.equal(valid(patch('c'),leads),false);
  assert.equal(valid({collections:{leads:{upsert:[{id:'new',status:'프리미팅 완료'}]}}},leads),true);
  for(const id of ['b','c']) assert.equal(valid({collections:{leads:{upsert:[{id,status:'프리미팅 완료'}]}}},leads),false);
});
test('scope rejects identity/root patches, arbitrary documents and malformed collections', () => {
  for(const path of [[],['id'],['__proto__','id'],['archived_at']]) assert.equal(valid(patch('a',path),leads),false);
  for(const mutation of [null,[],{documents:{ui:{}}},{deleteDocuments:['users']},{collections:{users:{}}},{collections:{leads:{patches:{}}}},{collections:{leads:{patches:[null]}}},{collections:{leads:{patches:[{id:'a',ops:[null]}]}}}]) assert.equal(valid(mutation,leads),false);
});
test('limited logs are lead-scoped append only; documents omit financial/marketing data', () => {
  const docs={users:[{id:'u',name:'Synthetic',email:'private'}],contractStatusLogs:[{id:'l',leadId:'a'},{id:'l2',leadId:'b'}],contractEvents:[],secret:{}};
  const output=premeetingDocuments(docs,leads);
  assert.deepEqual(Object.keys(output),['users','contractStatusLogs','contractEvents']);
  assert.equal(output.users[0].email,undefined); assert.equal(output.contractStatusLogs.length,1);
  assert.equal(valid({collections:{contractStatusLogs:{upsert:[{id:'l',leadId:'a'}]}}},leads,docs),false);
  assert.equal(valid({collections:{contractStatusLogs:{upsert:[{id:'new',leadId:'b'}]}}},leads,docs),false);
  assert.equal(valid({collections:{contractStatusLogs:{upsert:[{id:'new',leadId:'a'}]}}},leads,docs),true);
  assert.equal(canAccessAction({scope:'premeeting'},'sheet_bridge',{sheetAction:'premeeting_sync'}),true);
});
