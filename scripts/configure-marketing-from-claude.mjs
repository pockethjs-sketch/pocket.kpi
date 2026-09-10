import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECT_REF = "ilnklntqkdbbtzzbhqrl";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const sourceDir = process.env.POCKET_CLAUDE_CONNECTOR_DIR || join(homedir(), "meta_mcp_project");

function readRequired(name) {
  const value = readFileSync(join(sourceDir, name), "utf8").trim();
  if (!value) throw new Error(`${name} is empty`);
  return value;
}

function parseYaml(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function getServiceRoleKey() {
  const cliArgs = ["--yes", "supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "--output", "json"];
  const executable = process.platform === "win32" ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npx";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npx", ...cliArgs] : cliArgs;
  const raw = execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NPM_CONFIG_CACHE: join(process.cwd(), ".npm-cache") },
  });
  const keys = JSON.parse(raw);
  const service = keys.find((row) => row.id === "service_role" || row.name === "service_role");
  const key = service?.api_key || service?.key || service?.value;
  if (!key) throw new Error("Supabase service_role key was not returned by the authenticated CLI");
  return key;
}

const naver = readRequired("naver_keys.txt").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (naver.length < 3 || !/^\d+$/.test(naver[2])) throw new Error("naver_keys.txt must contain API key, secret key, and numeric customer id");
const google = parseYaml(readRequired("google-ads.yaml"));
for (const key of ["developer_token", "client_id", "client_secret", "refresh_token", "login_customer_id"]) {
  if (!google[key]) throw new Error(`google-ads.yaml is missing ${key}`);
}

const config = {
  MK_META_ACCESS_TOKEN: readRequired("meta_token.txt"),
  MK_META_AD_ACCOUNT_ID: "act_291478861018881",
  MK_META_GRAPH_VERSION: "v19.0",
  MK_META_TRAFFIC_PATTERN: "트래픽|traffic",
  MK_META_BUILDER_PATTERN: "빌더진|builderjin",
  MK_META_LEAD_PATTERN: "잠재|리드|lead|전환|conversion|문의|홈페이지",
  MK_NAVER_API_KEY: naver[0],
  MK_NAVER_SECRET_KEY: naver[1],
  MK_NAVER_CUSTOMER_ID: naver[2],
  MK_GOOGLE_CLIENT_ID: google.client_id,
  MK_GOOGLE_CLIENT_SECRET: google.client_secret,
  MK_GOOGLE_REFRESH_TOKEN: google.refresh_token,
  MK_GOOGLE_DEVELOPER_TOKEN: google.developer_token,
  // Claude의 기존 정상 수집기가 사용하는 실제 포켓 집행 계정입니다.
  // YAML의 login_customer_id는 포켓컴퍼니 MCC라 비용 지표 조회 대상이 아닙니다.
  MK_GOOGLE_CUSTOMER_ID: "4848410348",
  MK_GOOGLE_LOGIN_CUSTOMER_ID: "4848410348",
  MK_GOOGLE_API_VERSION: "v24",
  MK_BACKFILL_DAYS: "10",
};

async function probeGoogleRest() {
  const oauth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.MK_GOOGLE_CLIENT_ID,
      client_secret: config.MK_GOOGLE_CLIENT_SECRET,
      refresh_token: config.MK_GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const oauthBody = await oauth.json();
  if (!oauth.ok || !oauthBody.access_token) throw new Error(`Google OAuth probe failed (${oauth.status})`);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
  const response = await fetch(`https://googleads.googleapis.com/${config.MK_GOOGLE_API_VERSION}/customers/${config.MK_GOOGLE_CUSTOMER_ID}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oauthBody.access_token}`,
      "developer-token": config.MK_GOOGLE_DEVELOPER_TOKEN,
      "login-customer-id": config.MK_GOOGLE_LOGIN_CUSTOMER_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: `SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'` }),
  });
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ ok: response.ok, status: response.status, error: response.ok ? null : body }, null, 2));
  if (!response.ok) process.exitCode = 1;
}

async function probeGoogleAccounts() {
  const oauth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.MK_GOOGLE_CLIENT_ID, client_secret: config.MK_GOOGLE_CLIENT_SECRET,
      refresh_token: config.MK_GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const auth = await oauth.json();
  if (!oauth.ok || !auth.access_token) throw new Error(`Google OAuth probe failed (${oauth.status})`);
  const headers = { authorization: `Bearer ${auth.access_token}`, "developer-token": config.MK_GOOGLE_DEVELOPER_TOKEN,
    "login-customer-id": config.MK_GOOGLE_LOGIN_CUSTOMER_ID, "content-type": "application/json" };
  const stream = async (customerId, query) => {
    const response = await fetch(`https://googleads.googleapis.com/${config.MK_GOOGLE_API_VERSION}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST", headers, body: JSON.stringify({ query }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google account probe failed (${response.status})`);
    return (Array.isArray(body) ? body : [body]).flatMap((batch) => batch?.results || []);
  };
  const hierarchy = await stream(config.MK_GOOGLE_CUSTOMER_ID,
    "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client");
  const end = new Date().toISOString().slice(0, 10);
  const start = `${end.slice(0, 8)}01`;
  const accounts = [];
  for (const row of hierarchy) {
    const item = row.customerClient || {};
    if (item.manager === true || String(item.status || "").toUpperCase() === "CANCELED") continue;
    const id = String(item.clientCustomer || "").replace(/^customers\//, "").replace(/-/g, "");
    if (!id) continue;
    const metrics = await stream(id, `SELECT customer.descriptive_name, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`);
    const spend = metrics.reduce((sum, metric) => sum + Number(metric?.metrics?.costMicros || 0) / 1_000_000, 0);
    accounts.push({ id, name: item.descriptiveName || metrics[0]?.customer?.descriptiveName || "", spend });
  }
  console.log(JSON.stringify({ ok: true, start, end, accounts,
    hierarchySample: accounts.length ? undefined : hierarchy.slice(0, 10) }, null, 2));
}

if (process.argv.includes("--probe-google-accounts")) {
  await probeGoogleAccounts();
  process.exit();
}

if (process.argv.includes("--probe-google")) {
  await probeGoogleRest();
  process.exit();
}

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ ok: true, sourceDir, configKeys: Object.keys(config).sort() }, null, 2));
  process.exit(0);
}

const serviceKey = getServiceRoleKey();
const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kpi_store_marketing_config`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ p_config: config }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || body?.ok !== true) throw new Error(`Vault configuration failed (${response.status})`);
console.log(JSON.stringify({ ok: true, savedKeyCount: body.savedKeys?.length || 0, savedKeys: body.savedKeys || [] }, null, 2));
