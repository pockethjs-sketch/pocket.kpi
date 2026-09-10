import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const frontend = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const domain = await readFile(new URL("../supabase/functions/kpi-domain-api/index.ts", import.meta.url), "utf8");
const marketing = await readFile(new URL("../supabase/functions/kpi-marketing-sync/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260909031054_relational_domain_api_and_marketing_primary.sql", import.meta.url), "utf8");
const atomicMarketingMigration = await readFile(new URL("../supabase/migrations/20260910153000_marketing_atomic_provider_commit.sql", import.meta.url), "utf8");
const marketingCronMigration = await readFile(new URL("../supabase/migrations/20260910160000_marketing_cron_timeout.sql", import.meta.url), "utf8");
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

test("marketing collection runs in Edge, separates all Meta campaign classes, and protects direct rows", () => {
  for (const code of ["META_LEAD", "META_POCKET_TRAFFIC", "META_BUILDER_TRAFFIC", "META_OTHER"]) {
    assert.match(marketing, new RegExp(code));
    assert.match(domain, new RegExp(code));
  }
  assert.match(marketing, /objective\.includes\("TRAFFIC"\)/);
  assert.match(marketing, /builder\.test\(name\)/);
  assert.match(marketing, /MK_GOOGLE_CUSTOMER_ID/);
  assert.match(marketing, /kpi_read_marketing_config/);
  assert.match(marketing, /provider_sync_state/);
  assert.match(marketing, /kpi_commit_marketing_provider/);
  assert.match(migration, /payload->>'collector'='supabase-edge'/);
  assert.match(config, /\[functions\.kpi-marketing-sync\][\s\S]*verify_jwt = true/);
  const domainMarketingStart = frontend.indexOf("crmFetchDomainAction('marketing'");
  const domainMarketingEnd = frontend.indexOf("var unchanged", domainMarketingStart);
  const domainMarketingLoader = frontend.slice(domainMarketingStart, domainMarketingEnd);
  assert.ok(domainMarketingStart >= 0);
  assert.doesNotMatch(domainMarketingLoader, /crmFetchSheetAction\('marketing'/);
  assert.doesNotMatch(domainMarketingLoader, /directReady/);
  assert.match(domainMarketingLoader, /crmApplyMarketingEnvelope/);
});

test("direct provider writes validate complete coverage and commit atomically", () => {
  assert.match(atomicMarketingMigration, /pg_advisory_xact_lock/);
  assert.match(atomicMarketingMigration, /marketing_date_coverage_failed/);
  assert.match(atomicMarketingMigration, /marketing_row_validation_failed/);
  assert.match(atomicMarketingMigration, /payload->>'validated' = 'true'/);
  assert.match(atomicMarketingMigration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(atomicMarketingMigration, /grant execute[\s\S]*to anon/);
  assert.match(marketing, /zero_regression/);
  assert.match(marketing, /Object\.keys\(collectors\)\.every/);
});

test("scheduled marketing collection allows enough time for all three provider APIs", () => {
  assert.match(marketingCronMigration, /timeout_milliseconds\s*:=\s*120000/);
  assert.match(marketingCronMigration, /0 \*\/6 \* \* \*/);
});

test("domain response preserves Meta daily and monthly split including unclassified spend", () => {
  assert.match(domain, /otherSpend/);
  assert.match(domain, /campaigns:\s*\{ META: metaCampaigns \}/);
  assert.match(frontend, /기타 캠페인비/);
  assert.match(frontend, /기타 캠페인/);
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
