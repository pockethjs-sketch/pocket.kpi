import { execFileSync } from 'node:child_process';

// Explicit operator action only. No browser/session impersonation, no credential output.
if (!process.argv.includes('--apply')) throw new Error('explicit_apply_required');
const ref = 'ilnklntqkdbbtzzbhqrl';
const cli = ['--yes','supabase','projects','api-keys','--remote='+ref,'--reveal','--output','json','--log-level','none'];
let key;
try {
  const raw = execFileSync(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d','/s','/c','npx',...cli], {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const keys = JSON.parse(raw);
  const service = keys.find(k => k.type === 'secret' && k.name === 'default');
  key = service?.api_key || service?.key || service?.value;
} catch { throw new Error('current_deployment_credential_unavailable'); }
if (!key) throw new Error('current_service_key_unavailable');
const today = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const start = new Date(Date.parse(today+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);
const response = await fetch(`https://${ref}.supabase.co/functions/v1/kpi-crm-sync`, {
  method:'POST', headers:{apikey:key,'content-type':'application/json'},
  body:JSON.stringify({start,end:today,premeetingRepair:true}), signal:AbortSignal.timeout(120000),
});
key = undefined;
const value = await response.json();
const safeCode = value.message || value.error;
console.log(JSON.stringify({httpStatus:response.status,ok:value.ok===true,
  error:/^[a-zA-Z0-9_]+$/.test(safeCode||'')?safeCode:undefined,
  fetchedAt:value.fetchedAt,calendar:value.calendar,inflow:value.inflow,websiteInquiries:value.websiteInquiries}));
if (!response.ok || value.ok !== true) process.exitCode=1;
