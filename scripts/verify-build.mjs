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
  "createRoot(document.getElementById(\"root\"))",
];

for (const marker of requiredContracts) {
  if (!source.includes(marker)) throw new Error(`Required compatibility contract missing: ${marker}`);
}

console.log(JSON.stringify({ ok: true, jsFiles, cssFiles }, null, 2));
