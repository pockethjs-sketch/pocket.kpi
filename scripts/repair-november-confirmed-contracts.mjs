import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--rehearse')&&!args.includes('--apply'))throw Error('explicit_rehearsal_or_apply_required');
const sourceHash=value('--source-hash'),baseRevision=value('--base-revision');
if(!/^[a-f0-9]{64}$/.test(sourceHash||'')||!baseRevision)throw Error('source_hash_and_revision_required');
let key;
try{
  const raw=execFileSync(process.env.ComSpec||'C:/Windows/System32/cmd.exe',['/d','/s','/c','npx','--yes','supabase','projects','api-keys','--remote=ilnklntqkdbbtzzbhqrl','--reveal','--output','json','--log-level','none'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  key=JSON.parse(raw).find(k=>k.type==='secret'&&k.name==='default')?.api_key;
}catch{throw Error('current_deployment_credential_unavailable');}
if(!key)throw Error('current_service_key_unavailable');
const response=await fetch('https://ilnklntqkdbbtzzbhqrl.supabase.co/functions/v1/kpi-crm-sync',{
  method:'POST',headers:{apikey:key,'content-type':'application/json'},
  body:JSON.stringify({contractPaymentRepair:true,expectedSourceHash:sourceHash,baseRevision,dryRun:!args.includes('--apply'),excludePending:args.includes('--exclude-pending')}),signal:AbortSignal.timeout(120000),
});key=undefined;
const result=await response.json();
// Server response is deliberately metadata-only; no source records or identities.
console.log(JSON.stringify({httpStatus:response.status,...result}));
if(!response.ok||!result.ok)process.exitCode=1;
