import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const file = readdirSync(dir).find((name) => name.endsWith('_buildup_workspace_storage.sql'));
const sql = readFileSync(new URL(file, dir), 'utf8');

test('buildup consultation tables are server-only with forced RLS', () => {
  for (const table of ['buildup_projects', 'buildup_ai_usage']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
  }
  assert.match(sql, /revoke all on public\.buildup_projects, public\.buildup_ai_usage from anon, authenticated/);
  assert.match(sql, /grant select, insert, update on public\.buildup_projects, public\.buildup_ai_usage to service_role/);
  assert.doesNotMatch(sql, /grant[^;]*(anon|authenticated)/i);
  assert.doesNotMatch(sql, /create policy|security definer|disable row level security/i);
});

test('each consultation is keyed by organization, owner and project; deletes are soft', () => {
  assert.match(sql, /primary key \(organization_id, owner_user_id, project_id\)/);
  assert.match(sql, /owner_user_id uuid not null references public\.profiles\(id\)/);
  assert.match(sql, /deleted_at timestamptz/);
  assert.match(sql, /revision integer not null default 1/);
  assert.doesNotMatch(sql, /grant[^;]*\bdelete\b/i);
});

test('AI ledger stores model and token counts only, never prompts', () => {
  const ledger = sql.slice(sql.indexOf('create table if not exists public.buildup_ai_usage'), sql.indexOf('create index if not exists buildup_ai_usage_user_recent'));
  assert.match(ledger, /input_tokens integer/);
  assert.doesNotMatch(ledger, /prompt|content|messages|text not null default ''/i);
});
