import { createShadowRepository } from "./repositoryAdapter.js";

const repository = createShadowRepository();

export async function shadowAfterSheetsCommit(payload) {
  try {
    const result = await repository.afterPrimaryCommit(payload);
    window.crmShadowStatus = result.skipped ? result.reason : "committed";
    return result;
  } catch (error) {
    // Shadow failure must not roll back or misreport an already committed Sheets V3 mutation.
    window.crmShadowStatus = "failed:" + String(error && error.message || error);
    return { ok: false, error: window.crmShadowStatus };
  }
}

export async function shadowCompareSheetsSnapshot(snapshot, revision) {
  try {
    const result = await repository.compare(snapshot, revision);
    window.crmShadowCompare = result;
    return result;
  } catch (error) {
    window.crmShadowCompare = { equal: false, error: String(error && error.message || error) };
    return window.crmShadowCompare;
  }
}

export { repository as kpiShadowRepository };
