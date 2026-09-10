import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const frontend = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const domain = await readFile(new URL("../supabase/functions/kpi-domain-api/index.ts", import.meta.url), "utf8");
const marketing = await readFile(new URL("../supabase/functions/kpi-marketing-sync/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260909031054_relational_domain_api_and_marketing_primary.sql", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("frontend reads domain endpoints and writes mutations without a whole state upload", () => {
  for (const action of ["meta", "bootstrap", "crm", "marketing", "mutation"]) assert.match(frontend, new RegExp(`crmFetchDomainAction\\('${action}'`));
  assert.match(domain, /commit_primary_mutation/);
  assert.doesNotMatch(domain, /stateSnapshot/);
});

test("domain edge keeps service role server-side and checks the public app boundary", () => {
  assert.match(domain, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(domain, /KPI_PUBLIC_APP_TOKEN/);
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(config, /\[functions\.kpi-domain-api\][\s\S]*verify_jwt = true/);
  assert.match(frontend, /Authorization.*Bearer.*KPI_SUPABASE_ANON_KEY/);
});

test("contract and balance state is relationally projected while compatibility snapshots remain", () => {
  assert.match(migration, /create table if not exists public\.app_documents/);
  assert.match(migration, /s\.lead,/);
  assert.match(migration, /d\.lead,/);
  assert.match(migration, /app_state_daily_checkpoints/);
  assert.match(migration, /commit_primary_mutation/);
});

test("marketing collection runs in Edge, separates Meta campaign classes, and protects direct rows", () => {
  for (const code of ["META_LEAD", "META_POCKET_TRAFFIC", "META_BUILDER_TRAFFIC"]) assert.match(marketing, new RegExp(code));
  assert.match(marketing, /kpi_read_marketing_config/);
  assert.match(marketing, /provider_sync_state/);
  assert.match(migration, /payload->>'collector'='supabase-edge'/);
  assert.match(config, /\[functions\.kpi-marketing-sync\][\s\S]*verify_jwt = true/);
  assert.match(frontend, /directReady[\s\S]*crmFetchSheetAction\('marketing'/);
  assert.match(frontend, /\['META', 'NAVER', 'GOOGLE'\]\.every/);
});

test("marketing sync records missing credentials without overwriting the last successful snapshot", () => {
  assert.match(marketing, /status:\s*"DISABLED"/);
  assert.match(marketing, /error_code:\s*"missing_credentials"/);
  assert.match(marketing, /missingCredentialCount/);
  const missingBranch = marketing.match(/if \(missing\.length\) \{([\s\S]*?)continue;/)?.[1] || "";
  assert.doesNotMatch(missingBranch, /last_success_at/);
  assert.doesNotMatch(missingBranch, /latest_source_date/);
  assert.doesNotMatch(missingBranch, /amount_total/);
});
