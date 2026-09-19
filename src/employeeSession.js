import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://ilnklntqkdbbtzzbhqrl.supabase.co';
// This key is intentionally public. Every business request still requires a verified employee session.
export const PUBLISHABLE_KEY = 'sb_publishable_5ZOv7q88mKDVjefos5I3FA_ZxKGM3d7';
export const employeeAuth = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { storage: window.sessionStorage, storageKey: 'pocket-kpi-employee-session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function employeeHeaders() {
  const { data, error } = await employeeAuth.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('login_required');
  return { Authorization: `Bearer ${data.session.access_token}`, apikey: PUBLISHABLE_KEY };
}

export async function employeeRequest(action, body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/kpi-domain-api?action=${encodeURIComponent(action)}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { ...await employeeHeaders(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ ...body, action }) } : {}),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `http_${response.status}`);
  return result;
}

export function scopedEmployeeStorage(storage, userId) {
  if (!userId) throw new Error('login_required');
  const prefix = `kpi:employee:${userId}:`;
  return { getItem: (key) => storage.getItem(prefix + key), setItem: (key, value) => storage.setItem(prefix + key, value), removeItem: (key) => storage.removeItem(prefix + key) };
}
