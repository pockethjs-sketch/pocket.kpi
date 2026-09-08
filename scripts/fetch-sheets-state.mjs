import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.KPI_APPS_SCRIPT_URL || "";
const token = process.env.KPI_APPS_SCRIPT_TOKEN || "";
const output = process.env.KPI_STATE_OUTPUT || path.resolve("artifacts", "current-sheets-state.json");
if (!endpoint || !token) throw new Error("KPI_APPS_SCRIPT_URL and KPI_APPS_SCRIPT_TOKEN are required");

const url = new URL(endpoint);
url.searchParams.set("action", "state");
url.searchParams.set("token", token);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) throw new Error(`Apps Script state HTTP ${response.status}`);
const envelope = await response.json();
const state = typeof envelope.data === "string" ? JSON.parse(envelope.data) : envelope.data;
if (!state || !Array.isArray(state.leads)) throw new Error("Apps Script state payload is invalid");
state.revision = envelope.revision || state.revision || "unknown";
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(state));
console.log(JSON.stringify({ output, revision: state.revision, leads: state.leads.length }));
