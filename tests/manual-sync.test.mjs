import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { syncDataAndContracts, manualSyncError } from '../src/data/manualSync.js';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
function harness() {
  const calls = [];
  return { calls, io: {
    waitForCommit: async () => calls.push('save-ack'),
    primary: async () => { calls.push('crm'); return { ok: true }; },
    syncContracts: async () => { calls.push('sheet'); return { ok: true, action: 'contract_auto_sync', paymentUpdated: [{}] }; },
    reload: async () => calls.push('reload'),
  } };
}
test('manual data sync waits for both commits and then reconciles sheet payments before reload', async () => {
  const { calls, io } = harness();
  const result = await syncDataAndContracts(io);
  assert.deepEqual(calls, ['save-ack', 'crm', 'save-ack', 'sheet', 'reload']);
  assert.equal(result.sheet.paymentUpdated.length, 1);
});
test('pending input or CRM failure cannot start the sheet write', async () => {
  for (const phase of ['pending_save', 'primary', 'primary_save']) {
    const { calls, io } = harness(); let waits = 0;
    io.waitForCommit = async () => { if (++waits === (phase === 'primary_save' ? 2 : 1) && phase !== 'primary') throw Error('save_failed'); };
    if (phase === 'primary') io.primary = async () => { throw Error('crm_failed'); };
    await assert.rejects(syncDataAndContracts(io), error => error.stage === phase);
    assert.ok(!calls.includes('sheet'));
  }
});
test('sheet failure refreshes committed CRM and reports partial failure without rolling it back', async () => {
  const { calls, io } = harness();
  io.syncContracts = async () => { throw Error('sheet_unavailable'); };
  await assert.rejects(syncDataAndContracts(io), error => {
    assert.equal(error.primaryResult.ok, true);
    assert.match(manualSyncError(error), /CRM 반영 완료 · 계약 시트 반영 실패/);
    return error.stage === 'sheet';
  });
  assert.equal(calls.at(-1), 'reload');
});
test('invalid sheet response and failed reload never announce full success', async () => {
  const { io } = harness();
  io.syncContracts = async () => ({ ok: false, action: 'contract_auto_sync' });
  io.reload = async () => { throw Error('offline'); };
  await assert.rejects(syncDataAndContracts(io), e => e.stage === 'sheet' && e.reloadFailed);
  io.syncContracts = async () => ({ ok: true, action: 'contract_auto_sync' });
  await assert.rejects(syncDataAndContracts(io), e => e.stage === 'reload' && /서버 반영 완료 · 화면 재조회 실패/.test(manualSyncError(e)));
});
test('page and TM entry no longer call source refresh; both manual buttons run the combined pipeline', () => {
  const dbHook = source.slice(source.indexOf('function useDB()'), source.indexOf('/* --- 공용 UI --- */'));
  assert.doesNotMatch(dbHook, /crmShouldSync\(|crmFetchRefreshPayload\(|crmFetchPremeeting\(|fetchSupportBoard\(/);
  const tm = source.slice(source.indexOf('function TmManagementView()'), source.indexOf('function DealsView()'));
  assert.doesNotMatch(tm, /refreshCrmQuality\(\);/);
  assert.match(tm, /await syncDataAndContracts\(/);
  assert.match(tm, /crmApplyMutationLocal\(current, patch\)/);
  assert.match(source.slice(source.indexOf('const refreshTodayPremeetings = async')), /await syncDataAndContracts\(/);
});
test('premeeting tab mount only reads status and saved DB, including its interval callback', async () => {
  const start = source.indexOf('  useEffect(() => {', source.indexOf('const refreshContractReview = async'));
  const end = source.indexOf('  const sortBy', start);
  const calls = [], jobs = [];
  const s = { useEffect: fn => fn(), setInterval: fn => { jobs.push(fn); return 1; }, clearInterval: () => {},
    setSyncSchedule: () => {}, contractReviewRunning: { current: false },
    window: { crmRemoteApplied: true, crmRemoteLoaded: true, crmRemoteRevision: 'old',
      crmGetDailySyncStatus: async () => { calls.push('status'); return { sheet: { ok: true, at: '2026-09-30', revision: 'new' } }; },
      crmReloadAfterContractSync: async () => calls.push('saved-db') } };
  vm.runInNewContext(source.slice(start, end), s);
  await new Promise(resolve => setImmediate(resolve));
  await jobs[0]();
  assert.deepEqual(calls, ['status', 'saved-db', 'status']);
});

test('actual premeeting button chains sheet reconciliation once and releases the lock', async () => {
  const start = source.indexOf('  const refreshTodayPremeetings = async');
  const end = source.indexOf('  const addDeal', start);
  const calls = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const s = { syncDataAndContracts, manualSyncError, Date,
    contractReviewRunning: { current: false }, setCrmSyncBusy: () => {},
    setPremeetingResult: () => {}, setContractAutoSync: () => {}, setContractReviewError: () => {},
    toast: text => calls.push('toast'),
    window: { crmRemoteApplied: true, crmRemoteLoaded: true,
      crmWaitForRemoteCommit: async () => { calls.push('wait'); await pending; },
      crmSyncRecentPremeetings: async () => { calls.push('pre'); return { ok: true, action: 'premeeting_sync', count: 1, added: 0, updated: 1 }; },
      crmSyncNewContracts: async () => { calls.push('sheet'); return { ok: true, action: 'contract_auto_sync', paymentUpdated: [{}] }; },
      crmReloadAfterContractSync: async () => calls.push('reload') } };
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.run = refreshTodayPremeetings;', s);
  const first = s.run(); await s.run(); release(); await first;
  assert.deepEqual(calls, ['wait', 'pre', 'wait', 'sheet', 'reload', 'toast']);
  assert.equal(s.window.crmSyncInProgress, false);
  assert.equal(s.contractReviewRunning.current, false);
});

test('actual quality button applies changed fields to latest edits, then sheet syncs after acknowledgement', async () => {
  const initial = { leads: [{ id: 'synthetic-1', memo: 'old', payments: [{ amount: 100 }], crmSheet: { annualSales: 'old' } }] };
  let latest = structuredClone(initial); const calls = [];
  const s = { db: structuredClone(initial), crmSyncBusy: false, syncDataAndContracts, manualSyncError, Date, JSON,
    todayISO: () => '2026-09-30', qualityFingerprint: l => JSON.stringify(l.crmSheet),
    up: fn => { fn(latest); calls.push('local-patch'); },
    setCrmSyncBusy: () => {}, setLastManualSync: () => {}, toast: () => calls.push('toast'), localStorage: { setItem: () => {} },
    window: { crmRemoteApplied: true, crmRemoteLoaded: true,
      crmWaitForRemoteCommit: async () => calls.push('save-ack'),
      crmFetchRefreshPayload: async () => { latest.leads[0].memo = 'edited while waiting'; latest.leads[0].payments[0].amount = 200; return { leads: [] }; },
      crmFetchPremeeting: async next => { next.leads[0].crmSheet.annualSales = 'new'; return { db: next, count: 1, changed: true }; },
      crmSyncNewContracts: async () => { calls.push('sheet'); return { ok: true, action: 'contract_auto_sync' }; },
      crmReloadAfterContractSync: async () => calls.push('reload') } };
  vm.createContext(s);
  vm.runInContext(source.slice(source.indexOf('  var CRM_COLLECTION_ID_FIELDS ='), source.indexOf('  function crmSubmitMutationV3')), s);
  const start = source.indexOf('  const refreshCrmQuality = async');
  vm.runInContext(source.slice(start, source.indexOf('  const qualityOf', start)) + '\nglobalThis.run = refreshCrmQuality;', s);
  await s.run();
  assert.deepEqual(calls, ['save-ack', 'local-patch', 'save-ack', 'sheet', 'reload', 'toast']);
  assert.equal(latest.leads[0].memo, 'edited while waiting');
  assert.equal(latest.leads[0].payments[0].amount, 200);
  assert.equal(latest.leads[0].crmSheet.annualSales, 'new');
  assert.equal(s.window.crmSyncInProgress, false);
});
