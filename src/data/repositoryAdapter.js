const MODES = new Set(["sheets", "shadow-write", "read-compare"]);

export function readRepositoryConfig(env = import.meta.env) {
  const requested = String(env.VITE_KPI_DATA_BACKEND || "sheets").trim().toLowerCase();
  const mode = MODES.has(requested) ? requested : "sheets";
  return {
    mode,
    transport: "apps-script",
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function compareRepositorySnapshots(sheetSnapshot, shadowSnapshot) {
  const sheet = sheetSnapshot || {};
  const shadow = shadowSnapshot || {};
  const domains = ["leads", "deals", "contractEvents", "payments", "marketingDaily", "contractStatusLogs"];
  const differences = domains.filter((domain) => canonicalJson(sheet[domain] || []) !== canonicalJson(shadow[domain] || []));
  return { equal: differences.length === 0, differences };
}

export function shadowStatusFromSheetsResult(result) {
  if (result && result.primary === "supabase") {
    const backup = result.sheetsBackup || {};
    return {
      configured: true,
      state: backup.ok ? "committed-and-backed-up" : "committed-backup-pending",
      primary: "supabase",
      backupPending: backup.pending === true,
      error: backup.error || undefined,
    };
  }
  const shadow = result && result.shadow;
  if (!shadow || shadow.configured === false) return { configured: false, state: "disabled" };
  if (shadow.pendingRetry) return { configured: true, state: "pending-retry", error: shadow.error || "shadow_failed" };
  if (shadow.queued) return { configured: true, state: "queued", duplicate: Boolean(shadow.duplicate) };
  return { configured: true, state: "unknown" };
}
