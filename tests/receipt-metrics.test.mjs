import test from 'node:test';
import assert from 'node:assert/strict';
import{receiptPeriodMetrics}from'../src/data/receiptMetrics.js';
const range=['2026-11-01','2026-11-30'];
test('actual receipt card ignores inflow month, deduplicates companies and does not count undated completion',()=>{
  const leads=[{id:'a',company:'합성A',createdAt:'2026-06-01',payments:[{amount:100,paidAt:'2026-11-05'}]},
    {id:'b',company:'합성A',payments:[{amount:200,paidAt:'2026-11-06'},{amount:300,paidConfirmed:true,paidAt:''}]},
    {id:'c',company:'합성B',createdAt:'2026-11-01',paid:500,payments:[]},
    {id:'d',company:'합성C',payments:[{amount:500,paidAt:'2026-10-31'}]}];
  assert.deepEqual(receiptPeriodMetrics(leads,range),{companyCount:1,contractCount:2,amount:300});
});
test('CRM-managed installments use actual deposits, not their full plan, and archives stay excluded',()=>{
  const leads=[{id:'a',company:'합성A',payments:[{amount:1000,crmManaged:true,depositAmount:200,paidAt:'2026-11-05'}]},
    {id:'b',company:'합성B',archivedAt:'2026-11-01',payments:[{amount:1000,paidAt:'2026-11-05'}]}];
  assert.deepEqual(receiptPeriodMetrics(leads,range),{companyCount:1,contractCount:1,amount:200});
});
