const MODES = new Set(["sheets", "shadow-write", "read-compare"]);

export function readRepositoryConfig(env = import.meta.env) {
  const requested = String(env.VITE_KPI_DATA_BACKEND || "sheets").trim().toLowerCase();
  const mode = MODES.has(requested) ? requested : "sheets";
  return {
    mode,
    shadowUrl: String(env.VITE_KPI_SUPABASE_SHADOW_URL || "").replace(/\/$/, ""),
    publishableKey: String(env.VITE_KPI_SUPABASE_PUBLISHABLE_KEY || ""),
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

export function createShadowRepository({ config = readRepositoryConfig(), fetchImpl = fetch } = {}) {
  const enabled = config.mode !== "sheets" && Boolean(config.shadowUrl);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (config.publishableKey) headers.apikey = config.publishableKey;

  async function request(path, body) {
    if (!enabled) return { skipped: true, reason: "shadow_disabled" };
    const response = await fetchImpl(config.shadowUrl + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("shadow_http_" + response.status);
    return response.json();
  }

  return {
    config,
    async afterPrimaryCommit({ mutationId, mutation, revision }) {
      if (config.mode !== "shadow-write") return { skipped: true, reason: "not_shadow_write" };
      // The exact V3 mutation and idempotency key are forwarded only after Sheets COMMIT.
      return request("/shadow/mutations", { mutationId, mutation, primaryRevision: revision });
    },
    async compare(primarySnapshot, revision) {
      if (config.mode !== "read-compare") return { skipped: true, reason: "not_read_compare" };
      const result = await request("/shadow/snapshot", { primaryRevision: revision });
      return { ...compareRepositorySnapshots(primarySnapshot, result.snapshot), shadowRevision: result.revision };
    },
  };
}

