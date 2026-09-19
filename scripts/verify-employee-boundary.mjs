// Negative tests only. Never recover retired secrets, fetch customer data, or submit a valid mutation.
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/employeeSession.js', import.meta.url), 'utf8');
const key = source.match(/export const PUBLISHABLE_KEY = '([^']+)'/)?.[1];
if (!key?.startsWith('sb_publishable_')) throw new Error('Missing browser publishable key');
const base = 'https://ilnklntqkdbbtzzbhqrl.supabase.co/functions/v1/';
const headers = { apikey: key, authorization: 'Bearer invalid-employee-session-probe', 'content-type': 'application/json' };
for (const [name, action] of [['kpi-domain-api','session'], ['kpi-domain-api','mutation'], ['kpi-marketing-sync','invalid_auth_probe']]) {
  const response = await fetch(base + name, { method: 'POST', headers, body: JSON.stringify({ action }), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  console.log(JSON.stringify({ name, action, status: response.status, error: result.error }));
  if (![401,403].includes(response.status)) throw new Error('Unauthenticated browser request not denied');
}
for (const id of ['AKfycbwscZiacAZFqxAsW0cA6X75OxTkkqLReVoHatUyePPV8ihsWad4GxzmnKaLphJo7sQ','AKfycbx5cvbSXJs49-14DU8YR57OSzashkynhIeEqlZbU_P_1IHUEtO45KGOAEQJC9KYnADp','AKfycby1n61VSKiWuXU-umW1_ihKZlWgQIK0ZpiYIZME3kLdQ2kxtxhGt-BYCrity5yG65HQ']) {
  // No token on the URL: the new handler must reject even the bare URL before reading Sheets.
  const response = await fetch(`https://script.google.com/macros/s/${id}/exec`, { signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  console.log(JSON.stringify({ target: id.slice(0,12), status: response.status, error: result.error, backendVersion: result.backendVersion }));
  if (result.error !== 'employee_gateway_required') throw new Error('Apps Script boundary mismatch');
}
