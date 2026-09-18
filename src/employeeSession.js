import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://ilnklntqkdbbtzzbhqrl.supabase.co';
// Publishable client identity only. Authorization always requires an employee session.
export const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsbmtsbnRxa2RiYnR6emJocXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Mjk3NDQsImV4cCI6MjEwNDMwNTc0NH0.QoQ6jIFNo75LUtWU7YOvsO9cwWIsWZvlhFeuBgBvNac';
export const employeeAuth = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { storage: window.sessionStorage, storageKey: 'pocket-kpi-employee-session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function employeeHeaders() {
  const { data, error } = await employeeAuth.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('login_required');
  return { Authorization: `Bearer ${data.session.access_token}`, apikey: ANON_KEY };
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
