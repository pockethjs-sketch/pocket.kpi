// Temporary CI diagnostic (not for merge): print npm audit findings as workflow annotations.
import { spawnSync } from 'node:child_process';
const r = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
let data = {};
try { data = JSON.parse(r.stdout); } catch { console.log('::error title=audit::unparsable ' + String(r.stdout || '').slice(0, 300).replace(/\n/g, ' ') + ' | ' + String(r.stderr || '').slice(0, 300).replace(/\n/g, ' ')); process.exit(0); }
const vulns = Object.entries(data.vulnerabilities || {});
const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
vulns.sort((a, b) => (rank[a[1].severity] ?? 9) - (rank[b[1].severity] ?? 9));
for (const [name, info] of vulns.slice(0, 9)) {
  const via = (info.via || []).map((x) => typeof x === 'string' ? 'via ' + x : `${x.title} [${x.severity}] ${x.range} ${x.url}`).join(' | ');
  const fix = info.fixAvailable && typeof info.fixAvailable === 'object' ? `${info.fixAvailable.name}@${info.fixAvailable.version}${info.fixAvailable.isSemVerMajor ? ' (major)' : ''}` : String(info.fixAvailable);
  console.log(`::warning title=audit ${info.severity}::${name} ${info.range} direct=${info.isDirect} fix=${fix} :: ${via}`.slice(0, 900));
}
console.log('::warning title=audit summary::' + JSON.stringify((data.metadata || {}).vulnerabilities || {}) + ' code=' + r.status);
