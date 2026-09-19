import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const textExtensions = new Set(['.js', '.mjs', '.jsx', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.toml', '.html', '.css', '.gs']);
const findings = [];

for (const file of tracked) {
  const lower = file.toLowerCase();
  if ((lower === '.env' || lower.startsWith('.env.')) && lower !== '.env.example') findings.push([file, 'tracked environment file']);
  if (/\.(?:pem|p12|pfx|key)$/.test(lower)) findings.push([file, 'tracked private-key material']);
  if (/^artifacts\/.*(?:payload|snapshot|customer|lead).*\.json$/i.test(file)) findings.push([file, 'tracked business-data artifact']);
  if (!textExtensions.has(extname(lower)) || file === 'scripts/security-lint.mjs') continue;

  const scanSource = readFileSync(file, 'utf8');
  const rules = [
    ['private key literal', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Supabase secret key literal', /sb_secret_[A-Za-z0-9_-]{20,}/],
    ['GitHub access token literal', /gh[pousr]_[A-Za-z0-9_]{20,}/],
    ['Anthropic secret literal', /sk-ant-[A-Za-z0-9_-]{20,}/],
    ['Slack secret literal', /xox[baprs]-[A-Za-z0-9-]{20,}/],
    ['hard-coded bearer JWT', /Bearer\s+eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/],
    ['legacy JWT key literal', /['"]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+['"]/],
    ['non-empty shared browser secret', /(?:CRM_TOKEN|KPI_PUBLIC_APP_TOKEN)\s*=\s*['"][^'"]+['"]/],
    ['customer payload console dump', /console\.(?:log|debug|info)\([^\n]*(?:source_payload|customer_payload|lead_payload)/i],
  ];
  for (const [label, pattern] of rules) if (pattern.test(scanSource)) findings.push([file, label]);
}

const boundary = readFileSync('scripts/verify-employee-boundary.mjs', 'utf8');
if (/git\s+show|execFileSync\s*\(|node:child_process/.test(boundary)) findings.push(['scripts/verify-employee-boundary.mjs', 'credential recovery from Git history']);
if (/x-kpi-app-token/i.test(boundary)) findings.push(['scripts/verify-employee-boundary.mjs', 'retired shared-token probe']);

if (findings.length) {
  for (const [file, label] of findings) console.error(`SECURITY: ${file}: ${label}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, trackedFilesChecked: tracked.length, policy: 'no-secrets-no-customer-dumps-no-history-recovery' }));
