/** CRM recent-three-day and contract-sheet synchronization; Supabase primary. */
var CRM_CALENDAR_API = 'https://api.xn--9i1b674cwc38r6pa.com/crm/v3/mr_schedules';
var CRM_CALENDAR_TZ = 'Asia/Seoul';
var CRM_DAILY_SETUP_HASH = 'c6a473511441f2a0f2ee62dc87555d1ec15549f761afe6018f98b81c9cabf56d';
function setCrmCalendarJwt(token) {
  var value = String(token || '').replace(/^Bearer\s+/i, '').trim();
  if (!value) throw new Error('CRM JWT가 비어 있습니다.');
  PropertiesService.getScriptProperties().setProperty('CRM_JWT', value);
}
function saveCrmCalendarJwt() {
  var ui = SpreadsheetApp.getUi(), r = ui.prompt('CRM Bearer 토큰', 'JWT 문자열을 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() === ui.Button.OK) setCrmCalendarJwt(r.getResponseText());
}
function _crmSyncRecord(kind, result) {
  var compact = { ok: !!result.ok, at: _crmIso(), date: crmRecentPremeetingRange(_crmIso()).end,
    revision: result.revision || '', count: result.count || 0, added: result.added || 0,
    updated: Array.isArray(result.updated) ? result.updated.length : (result.updated || 0),
    paymentUpdated: Array.isArray(result.paymentUpdated) ? result.paymentUpdated.length : 0,
    blocked: (result.blocked || []).length, range: result.range || null, error: result.ok ? '' : 'sync_failed' };
  PropertiesService.getScriptProperties().setProperty('KPI_SYNC_' + kind, JSON.stringify(compact));
  return result;
}
function _crmDailySyncStatus() {
  var p = PropertiesService.getScriptProperties(), read = function(k) { try { return JSON.parse(p.getProperty(k) || 'null'); } catch(e) { return null; } };
  return { ok: true, action: 'daily_sync_status', timezone: CRM_CALENDAR_TZ, hour: 9, lookbackDays: 3,
    premeeting: read('KPI_SYNC_premeeting'), sheet: read('KPI_SYNC_sheet'), daily: read('KPI_SYNC_daily'),
    enabledFrom: p.getProperty('KPI_DAILY_ENABLED_FROM') || '',
    triggerCount: ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'runPocketDailySync'; }).length };
}
function _crmFetchRecentCalendar(range) {
  // Reuse the deployed Supabase Edge path and its current CRM secret.
  // Do not revive the stale legacy Script Property token as the primary path.
  var payload = _crmFetchRefreshPayload(range.start, range.end);
  if (!payload || !payload.ok || !Array.isArray(payload.meetings)) throw new Error('premeeting_source_' + String(payload && payload.error || 'invalid'));
  if (payload.meetings.length >= 1000) throw new Error('crm_calendar_page_limit');
  return payload.meetings;
}
function _crmRunPremeetingSync(body) {
  body = body || {};
  var now = _crmIso(), range = crmRecentPremeetingRange(now), status = _crmDailySyncStatus().premeeting;
  if (body.skipToday && status && status.ok && status.date === range.end && status.range && status.range.start === range.start)
    return { ok: true, action: 'premeeting_sync', skipped: 'already_successful_today', previous: status };
  try {
    var rows = _crmFetchRecentCalendar(range);
    for (var attempt = 0; attempt < 3; attempt++) {
      var envelope = _crmReadSupabasePrimaryEnvelope_();
      var plan = crmPlanRecentPremeetings(rows, JSON.parse(envelope.data), now, _crmHash);
      var summary = { ok: true, action: 'premeeting_sync', dryRun: !!body.dryRun, range: range, count: plan.count,
        completed: plan.completed, scheduled: plan.scheduled, added: plan.added, updated: plan.updated,
        blocked: plan.blocked, companies: plan.companies, revision: envelope.revision };
      if (body.dryRun) return summary;
      if (plan.added + plan.updated) {
        var result = _crmSaveMutationV2({ baseRevision: envelope.revision,
          mutationId: 'premeeting-' + _crmHash(envelope.revision + JSON.stringify(plan.mutation)).slice(0,36), mutation: plan.mutation });
        if (result && result.error === 'revision_conflict') continue;
        if (!result || !result.ok) throw new Error('premeeting_commit_failed');
        summary.revision = result.revision;
      }
      return _crmSyncRecord('premeeting', summary);
    }
    throw new Error('premeeting_revision_busy');
  } catch(e) { if (!body.dryRun) _crmSyncRecord('premeeting', { ok: false, range: range }); throw e; }
}
function _crmRunSheetSync(body) {
  try {
    var result = _crmAutoSyncNewContracts(body || {});
    if (!body || !body.dryRun) _crmSyncRecord('sheet', result || { ok:false });
    return result;
  } catch(e) { if (!body || !body.dryRun) _crmSyncRecord('sheet', { ok:false }); throw e; }
}
function syncPremeetings() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return _crmRunPremeetingSync({}); } finally { lock.releaseLock(); }
}
/** Five-minute wakeups only check a clock gate; source APIs run once per KST day after 09:00. */
function runPocketDailySync() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return;
  try {
    var p = PropertiesService.getScriptProperties(), now = _crmIso(), day = crmRecentPremeetingRange(now).end;
    if (Number(Utilities.formatDate(new Date(now), CRM_CALENDAR_TZ, 'H')) < 9 || day < (p.getProperty('KPI_DAILY_ENABLED_FROM') || '9999')) return;
    if (p.getProperty('KPI_DAILY_ATTEMPT_DAY') === day) return;
    p.setProperty('KPI_DAILY_ATTEMPT_DAY', day);
    var outcome = { ok: true };
    try { _crmRunPremeetingSync({ skipToday: true }); } catch(e) { outcome.ok = false; }
    try { var sheet = _crmRunSheetSync({}); if (!sheet || !sheet.ok) outcome.ok = false; } catch(e) { outcome.ok = false; }
    var status = _crmDailySyncStatus();
    p.setProperty('KPI_SYNC_daily', JSON.stringify({ ok: outcome.ok, date: day, startedAt: now, finishedAt: _crmIso(), premeeting: status.premeeting, sheet: status.sheet }));
    if (!outcome.ok) throw new Error('pocket_daily_sync_failed');
    return { ok:true, date:day };
  } finally { lock.releaseLock(); }
}
function setupDailyTrigger() {
  var existing = ScriptApp.getProjectTriggers().slice(), keep = existing.filter(function(t) { return t.getHandlerFunction() === 'runPocketDailySync'; });
  if (!keep.length) ScriptApp.newTrigger('runPocketDailySync').timeBased().everyMinutes(5).create();
  existing.forEach(function(t) { if (t.getHandlerFunction() === 'syncPremeetings' || (t.getHandlerFunction() === 'runPocketDailySync' && t !== keep[0])) ScriptApp.deleteTrigger(t); });
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('KPI_DAILY_ENABLED_FROM')) {
    var today = crmRecentPremeetingRange(_crmIso()).end;
    p.setProperty('KPI_DAILY_ENABLED_FROM', new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0,10));
  }
  return _crmDailySyncStatus();
}
function _crmSetupDailyOnce(body) {
  var p = PropertiesService.getScriptProperties();
  if (!body.setupKey || _crmHash(String(body.setupKey)) !== CRM_DAILY_SETUP_HASH || p.getProperty('KPI_DAILY_SETUP_USED') === CRM_DAILY_SETUP_HASH) return { error:'forbidden' };
  var result = setupDailyTrigger(); p.setProperty('KPI_DAILY_SETUP_USED', CRM_DAILY_SETUP_HASH); return result;
}
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { if (['syncPremeetings','runPocketDailySync'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
}
