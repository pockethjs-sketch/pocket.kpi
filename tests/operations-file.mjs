import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The operator-owned Apps Script checkout is intentionally not a public CI input.
// Repository auth/calendar tests still run. Only tests of that absent source skip.
export function operationsFile(name) {
  const root = process.env.KPI_OPS_TEST_ROOT || fileURLToPath(new URL('../../pocket-kpi-deploy/', import.meta.url));
  const path = resolve(root, name);
  if (!existsSync(path) && process.env.CI === 'true') return null;
  return readFileSync(path, 'utf8'); // Missing local source remains an error.
}
export const missingOperationsSource = 'operator-owned Apps Script source absent from CI; locally verified separately';
