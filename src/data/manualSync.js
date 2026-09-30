// No timers or mount hooks: invoked exclusively by an explicit sync action.
export async function syncDataAndContracts({ waitForCommit, primary, syncContracts, reload }) {
  let stage = 'pending_save', primaryResult = null, sheetResult = null;
  try {
    await waitForCommit();
    stage = 'primary';
    primaryResult = await primary();
    stage = 'primary_save';
    await waitForCommit();
    stage = 'sheet';
    sheetResult = await syncContracts();
    if (!sheetResult || sheetResult.ok === false || sheetResult.error || sheetResult.action !== 'contract_auto_sync') {
      throw new Error('contract_sync_failed');
    }
    stage = 'reload';
    await reload();
    return { primary: primaryResult, sheet: sheetResult };
  } catch (cause) {
    // A committed first step must remain visible even if the sheet bridge fails.
    let reloadFailed = false;
    if (stage === 'sheet') {
      try { await reload(); } catch { reloadFailed = true; }
    }
    const error = new Error(String(cause?.message || cause), { cause });
    Object.assign(error, { stage, primaryResult, sheetResult, reloadFailed });
    throw error;
  }
}

export function manualSyncError(error) {
  const code = String(error?.message || error);
  if (error?.stage === 'sheet') return 'CRM 반영 완료 · 계약 시트 반영 실패 · 시트 동기화로 재시도' + (error.reloadFailed ? ' · 화면 재조회도 실패' : '') + ' · ' + code;
  if (error?.stage === 'reload') return 'CRM·계약 시트 서버 반영 완료 · 화면 재조회 실패 · ' + code;
  if (error?.stage === 'primary_save' || error?.stage === 'pending_save') return '저장 확인 실패 · 계약 시트 반영은 실행하지 않음 · ' + code;
  return 'CRM 동기화 실패 · ' + code;
}
