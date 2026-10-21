// Temporary CI helper (not for merge): build the vite security update with real npm and hand the
// package.json/package-lock.json diff back as workflow annotations (gzip + base64 chunks).
import { execSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
execSync('npm install --save-dev --save-exact vite@8.3.4 --package-lock-only --ignore-scripts --no-audit --no-fund', { stdio: 'inherit' });
const diff = execSync('git diff --no-color -- package.json package-lock.json').toString();
const sha = createHash('sha256').update(diff).digest('hex');
const b64 = gzipSync(Buffer.from(diff), { level: 9 }).toString('base64');
const size = 3500, chunks = [];
for (let i = 0; i < b64.length; i += size) chunks.push(b64.slice(i, i + size));
const kinds = ['notice', 'warning', 'error'];
chunks.forEach((c, i) => console.log(`::${kinds[Math.floor(i / 10)] || 'error'} title=patch ${String(i).padStart(2, '0')}/${chunks.length}::${c}`));
const audit = spawnSync('npm', ['audit', '--audit-level=high', '--json'], { encoding: 'utf8' });
let meta = {};
try { meta = JSON.parse(audit.stdout).metadata.vulnerabilities; } catch { meta = { parse: 'failed' }; }
console.log(`::notice title=patch meta::sha256=${sha} bytes=${diff.length} chunks=${chunks.length} audit_after=${JSON.stringify(meta)} audit_code=${audit.status}`);
