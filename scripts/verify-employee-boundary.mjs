// Negative tests only. Never fetch customer data or submit a valid mutation.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const source = readFileSync(new URL('../src/employeeSession.js', import.meta.url), 'utf8');
const key = source.match(/export const ANON_KEY = '([^']+)'/)[1];
const base = 'https://ilnklntqkdbbtzzbhqrl.supabase.co/functions/v1/';
// The retired public value is used only for deny-tests, never to read business records.
const retired = execFileSync('git', ['show', '0942734:src/main.jsx'], { encoding: 'utf8', maxBuffer: 2_000_000 }).match(/var CRM_TOKEN = '([^']+)'/)[1];
const headers = { apikey: key, authorization: `Bearer ${key}`, 'x-kpi-app-token': retired, 'content-type': 'application/json' };
for (const [name, action] of [['kpi-domain-api','session'], ['kpi-domain-api','mutation'], ['kpi-marketing-sync','invalid_auth_probe']]) {
  const response = await fetch(base + name, { method: 'POST', headers, body: JSON.stringify({ action }), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  console.log(JSON.stringify({ name, action, status: response.status, error: result.error }));
  if (![401,403].includes(response.status)) throw new Error('Retired browser credential not denied');
}
for (const id of ['AKfycbwscZiacAZFqxAsW0cA6X75OxTkkqLReVoHatUyePPV8ihsWad4GxzmnKaLphJo7sQ','AKfycbx5cvbSXJs49-14DU8YR57OSzashkynhIeEqlZbU_P_1IHUEtO45KGOAEQJC9KYnADp','AKfycby1n61VSKiWuXU-umW1_ihKZlWgQIK0ZpiYIZME3kLdQ2kxtxhGt-BYCrity5yG65HQ']) {
  // No token on the URL: the new handler must reject even the bare URL before reading Sheets.
  const response = await fetch(`https://script.google.com/macros/s/${id}/exec`, { signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  console.log(JSON.stringify({ target: id.slice(0,12), status: response.status, error: result.error, backendVersion: result.backendVersion }));
  if (result.error !== 'employee_gateway_required') throw new Error('Apps Script boundary mismatch');
}
