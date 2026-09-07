import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeExport, reconcileExport } from "./migration-lib.mjs";

const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : ""; };
const apply = args.has("--apply");
const inputPath = valueAfter("--input");
const outDir = valueAfter("--out") || path.resolve("artifacts", "supabase-migration");
if (!inputPath) throw new Error("--input <normalized-sheets-export.json> is required");
if (apply && !args.has("--confirm-new-project")) throw new Error("--apply requires --confirm-new-project");
if (apply && (!process.env.KPI_SUPABASE_MIGRATION_URL || !process.env.KPI_SUPABASE_MIGRATION_TOKEN)) {
  throw new Error("apply requires server-only KPI_SUPABASE_MIGRATION_URL and KPI_SUPABASE_MIGRATION_TOKEN");
}

const source = JSON.parse(await readFile(inputPath, "utf8"));
const runId = randomUUID();
const normalized = normalizeExport(source);
const reconciliation = reconcileExport(normalized);
const report = {
  runId, mode: apply ? "apply" : "dry-run", sourceRevision: String(source.revision || "unknown"),
  sourceHash: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
  generatedAt: new Date().toISOString(), reconciliation,
  checkpoint: { entity: null, offset: 0, complete: false },
};

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, `${runId}-report.json`), JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, `${runId}-payload.json`), JSON.stringify(normalized, null, 2));

if (reconciliation.invalidRows.length || reconciliation.duplicates.length) {
  throw new Error(`migration blocked: invalid=${reconciliation.invalidRows.length} duplicates=${reconciliation.duplicates.length}`);
}

if (apply) {
  const response = await fetch(process.env.KPI_SUPABASE_MIGRATION_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.KPI_SUPABASE_MIGRATION_TOKEN}`, "content-type": "application/json", "idempotency-key": runId },
    body: JSON.stringify({ runId, sourceRevision: report.sourceRevision, sourceHash: report.sourceHash, entities: normalized }),
  });
  if (!response.ok) throw new Error(`migration gateway HTTP ${response.status}`);
  const result = await response.json();
  report.checkpoint = result.checkpoint || report.checkpoint;
  report.targetReconciliation = result.reconciliation || null;
  report.complete = Boolean(result.complete);
  await writeFile(path.join(outDir, `${runId}-report.json`), JSON.stringify(report, null, 2));
  if (!report.complete) throw new Error("migration gateway did not report completion");
}

console.log(JSON.stringify({ runId, mode: report.mode, counts: reconciliation.counts, totals: reconciliation.totals }, null, 2));

