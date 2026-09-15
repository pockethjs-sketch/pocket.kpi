import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseContractHistory} from './contract-history-parser.mjs';

// Data stays in ignored artifacts and private DB, never in the public frontend bundle.
const input=process.argv.find(a=>a.startsWith('--source='))?.slice(9) || 'artifacts/contract-history-source.json';
const history=parseContractHistory(JSON.parse(readFileSync(input,'utf8')));
const hash=createHash('sha256').update(JSON.stringify([history.months,history.owners,history.details])).digest('hex');
const q=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const org="'c9e1a7bd-f412-4fc5-a002-2226c5c586fd'::uuid";
const tables=[
 ['contract_history_months',history.months.map(m=>({...m,source_id:history.sourceId,source_hash:hash})),['organization_id','month']],
 ['contract_history_owners',history.owners,['organization_id','month','source_column']],
 ['contract_history_details',history.details,['organization_id','month','source_cell']],
];
for(const m of history.months){
  const rows=history.details.filter(d=>d.month===m.month);
  if(m.has_details && rows.reduce((s,r)=>s+(r.contract_amount||0),0)!==m.list_total_amount) throw new Error('Source detail total mismatch '+m.month);
}
let sql=`begin; set local lock_timeout='5s';\nselect pg_advisory_xact_lock(hashtextextended('contract-history-import',0));\n`;
sql+=`do $$ begin if not exists(select 1 from public.organizations where id=${org} and slug='pocket-kpi') then raise exception 'wrong_organization'; end if; end $$;\n`;
for(const [table,rows,keys] of tables){
  const columns=['organization_id',...Object.keys(rows[0])];
  const values=rows.map(r=>'('+[org,...Object.values(r).map(q)].join(',')+')').join(',\n');
  sql+=`create temp table expected_${table} (like public.${table} including defaults) on commit drop;\n`;
  sql+=`insert into expected_${table} (${columns.join(',')}) values ${values};\n`;
  sql+=`insert into public.${table} (${columns.join(',')}) select ${columns.join(',')} from expected_${table} on conflict (${keys.join(',')}) do nothing;\n`;
  // Repeated identical imports are no-op; source changes require a separate reviewed import.
  sql+=`do $$ begin if exists(select ${columns.join(',')} from expected_${table} except select ${columns.join(',')} from public.${table} where organization_id=${org}) then raise exception 'history_conflict_${table}'; end if; end $$;\n`;
}
sql+=`commit; select 'contract_history' as imported, (select count(*) from public.contract_history_months where organization_id=${org}) as months, (select count(*) from public.contract_history_details where organization_id=${org}) as details;`;
mkdirSync('artifacts',{recursive:true});
const path=resolve('artifacts/contract-history-import.sql');writeFileSync(path,sql);
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',months:history.months.length,owners:history.owners.length,details:history.details.length,sha256:hash}));
if(process.argv.includes('--apply')){
  if(!process.env.KPI_SUPABASE_CLI) throw new Error('Set KPI_SUPABASE_CLI to authenticated CLI executable');
  console.log(execFileSync(process.env.KPI_SUPABASE_CLI,['db','query','--linked','--project-ref','ilnklntqkdbbtzzbhqrl','--file',path,'-o','json'],{encoding:'utf8',windowsHide:true}));
}
