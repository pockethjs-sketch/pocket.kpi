import { createHash } from 'node:crypto';
import { readConfirmedContracts } from './confirmed-contract-source.mjs';
import { NOVEMBER_PAYMENT_MANIFEST } from './november-payment-manifest.mjs';
const hash=async(value,algorithm='sha256')=>createHash(algorithm).update(String(value)).digest('hex');

export async function handleConfirmedContractRepair(body,supabase,organizationId,{readSource=readConfirmedContracts}={}) {
  if(!/^[0-9a-f]{64}$/.test(body.expectedSourceHash||'')||!body.baseRevision||typeof body.dryRun!=='boolean')return {status:400,body:{error:'repair_request_invalid'}};
  try {
    const manifest=body.excludePending===true?NOVEMBER_PAYMENT_MANIFEST.filter(x=>x.keyHash!=='5caf3a768ff6d672fddfb27442829ab1'):NOVEMBER_PAYMENT_MANIFEST;
    const source=await readSource(manifest,hash);
    if(source.sourceHash!==body.expectedSourceHash)throw Error('repair_source_changed');
    const fetchedAt=new Date().toISOString();
    const {data,error}=await supabase.rpc('kpi_repair_november_confirmed_contracts',{
      p_organization_id:organizationId,p_base_revision:body.baseRevision,p_source_hash:source.sourceHash,
      p_fetched_at:fetchedAt,p_rows:source.rows,p_dry_run:body.dryRun,
    });
    if(error) return {status:409,body:{error:'repair_transaction_failed',code:/^[a-zA-Z0-9_]+$/.test(error.message||'')?error.message:'repair_database_error'}};
    return {status:200,body:{...data,sourceRowCount:source.sourceRowCount}};
  } catch(e){const code=String(e?.message||'');return {status:502,body:{error:/^[a-zA-Z0-9_]+$/.test(code)?code:'repair_source_failed'}};}
}
