import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");

const forbidden = [
  "cdn.tailwindcss.com",
  "@babel/standalone",
  "type=\"text/babel\"",
  "esm.sh/react",
];

for (const marker of forbidden) {
  if (html.includes(marker)) throw new Error(`Runtime dependency remained in build: ${marker}`);
}

const assets = fs.readdirSync(path.join(dist, "assets"));
const jsFiles = assets.filter((name) => name.endsWith(".js"));
const cssFiles = assets.filter((name) => name.endsWith(".css"));

if (jsFiles.length < 2) throw new Error("Expected separated application/vendor JavaScript chunks.");
if (!cssFiles.length) throw new Error("Expected compiled CSS asset.");

const source = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const requiredContracts = [
  "pocketcrm:db:v4",
  "crm:pendingMutations:v1",
  "crmFetchSheetAction('meta'",
  "crmFetchSheetAction('marketing'",
  "crmFetchSheetAction('state'",
  "function DealsView",
  "function LtvExpansionView",
  "window.kpiEmployeeAccess",
];

for (const marker of requiredContracts) {
  if (!source.includes(marker)) throw new Error(`Required compatibility contract missing: ${marker}`);
}

const entry = fs.readFileSync(path.join(root, "src", "EmployeeEntry.jsx"), "utf8");
if (!entry.includes("await employeeRequest('session')") || !entry.includes("await import('./main.jsx')")) throw new Error("Employee authentication entry missing");
for (const name of jsFiles) {
  const js = fs.readFileSync(path.join(dist, 'assets', name), 'utf8');
  if (js.includes('pocket-crm-9f3k7x')) throw new Error('Retired shared token in public bundle');
}

console.log(JSON.stringify({ ok: true, jsFiles, cssFiles }, null, 2));
