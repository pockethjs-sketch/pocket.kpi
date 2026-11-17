import {readSheetPaymentReport} from './contract-sheet-report.mjs';
import {buildContractReviewItems,reviewLeadId} from '../../../src/data/contractReviewMatches.js';
import {contractReviewPreview} from '../../../src/data/contractReviewPreview.js';
import {_crmSyncAliases as aliases} from '../../../scripts/contract-sheet-sync-core.mjs';
const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,'');
export const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function prepareSheetContract(report,state,request,actor,now=new Date().toISOString()) {
  if(!/^[a-f0-9]{64}$/.test(request.contractKey||'')||!['standalone','linked'].includes(request.creationMode)||!['신규','기존'].includes(request.customerType))throw Error('contract_source_held');
  if(report.sourceHash!==request.reportSourceHash)throw Error('contract_source_changed');
  const identities=await Promise.all(report.rows.map(async r=>({row:r,key:await sha(JSON.stringify([aliases(r.company)[0]||norm(r.company),r.date,norm(r.dealText)]))})));
  const selected=identities.filter(x=>x.key===request.contractKey);
  if(selected.length!==1)throw Error('contract_source_held');
  const row=selected[0].row,leadId=reviewLeadId({contractKey:request.contractKey});
  const existing=(state.leads||[]).find(l=>l.id===leadId||l.contractSheetContractKey===request.contractKey);
  if(existing&&!existing.contractSheetScopedCreate)throw Error('contract_already_exists');
  // Keep every same-company/date source row for duplicate and linkage guards.
  const names=aliases(row.company);
  const subset=report.rows.filter(r=>r.date===row.date&&aliases(r.company).some(a=>names.includes(a)));
  const review=await buildContractReviewItems({...report,rows:subset,rangeRows:subset.length},{...state,leads:(state.leads||[]).filter(l=>l!==existing)});
  const item=review.items.find(i=>i.contractKey===request.contractKey);
  if(!item||item.sourceHash!==request.sourceHash)throw Error('contract_candidate_changed');
  const chosen={...item,creationMode:request.creationMode,customerTypeOverride:request.customerType,targetId:request.parentId||''};
  const p=contractReviewPreview(chosen);if(!p.canAdd)throw Error('contract_source_held');
  const payments=[];
  const todayKst=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
  if(p.confirmedPaid>0)payments.push({id:'sheet-confirmed-'+request.contractKey.slice(0,32),no:1,label:'계약 시트 확인입금',amount:p.confirmedPaid,dueAt:'',paidAt:row.actualPaidAt||'',paidConfirmed:true,...(!row.actualPaidAt?{actualPaidAtUnknown:true}:{}),method:'',memo:''});
  if(p.confirmedPaid<p.contractAmount)payments.push({id:'sheet-remaining-'+request.contractKey.slice(0,32),no:payments.length+1,label:p.confirmedPaid?'잔여 금액':'계약 금액',amount:p.contractAmount-p.confirmedPaid,dueAt:'',paidAt:'',paidConfirmed:false,method:'',memo:''});
  const lead={id:leadId,manualEntry:false,contractSheetImported:true,contractSheetScopedCreate:true,company:item.company,contact:'',phone:'',email:'',
    channel:'계약 프로세스 시트',creative:'',buildup:row.service||'',buildups:[row.service].filter(Boolean),grade:'',status:'계약 완료',ctype:p.customerType,tmOwner:'',salesOwner:row.owner||'',
    expected:p.contractAmount,contractAmount:p.contractAmount,paid:p.confirmedPaid,payments,sent:{},newsletter:false,pushLog:[],premeetingAt:'',premeetingDoneAt:'',bookedAt:'',contractAt:row.date,createdAt:'',memo:'',
    lineItems:[{id:'contract-sheet-line-'+request.contractKey+'-'+row.row,buildup:row.service||'',name:row.dealText,price:p.contractAmount,source:'계약 프로세스 시트',sourceRow:row.row,sourceHash:item.sourceHash}],
    contractSheetContractKey:request.contractKey,contractCompanyLeadId:p.parentId,contractSheetCreationMode:p.creationMode,contractSheetSourceCustomerType:item.ctype||'',contractSheetPaymentNotCompared:p.paymentNotCompared,
    history:[{date:todayKst,type:'계약 시트',note:'개별 승인 계약 생성 · 날짜 추정 없음',actor}]};
  const event={id:'contract-source-'+request.contractKey+'-'+row.row,leadId,company:item.company,sourceKey:request.contractKey,sourceHash:item.sourceHash,sourceRows:[row.row],firstDate:row.date,lastDate:row.date,services:[row.service].filter(Boolean),amount:p.contractAmount,numericPaid:p.confirmedPaid,ctype:p.customerType,sourceCustomerType:item.ctype||'',owner:row.owner||'',sourceData:[row],appliedAt:now,actor};
  const log={id:'sheet-create-'+request.contractKey,at:now,date:todayKst,leadId,company:item.company,action:'외부 시트 생성',source:'계약 프로세스 시트',actor,detail:'개별 승인 계약·확인 입금 저장',meta:{sourceKey:request.contractKey,sourceHash:item.sourceHash,contractAmount:p.contractAmount,paid:p.confirmedPaid,paymentNotCompared:p.paymentNotCompared,creationMode:p.creationMode,customerType:p.customerType,sourceCustomerType:item.ctype||'',parentId:p.parentId}};
  const requestHash=await sha(JSON.stringify([request.contractKey,p.contractAmount,p.confirmedPaid,row.actualPaidAt||'',p.creationMode,p.customerType,p.parentId,item.ctype||'']));
  return {lead,event,log,requestHash};
}
export async function handleSheetContractCreate(body,client,organizationId,actor,{readSource=readSheetPaymentReport}={}) {
  try {
    const {data:state,error}=await client.from('app_current_state').select('primary_revision,state_snapshot').eq('organization_id',organizationId).single();
    if(error||!state?.state_snapshot)return {status:503,body:{error:'contract_state_unavailable'}};
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const report=await readSource({start:'2026-08-01',end:today,mode:'contracts'});
    const prepared=await prepareSheetContract(report,state.state_snapshot,body,actor);
    const result=await client.rpc('kpi_create_sheet_contract',{p_organization_id:organizationId,p_base_revision:state.primary_revision,p_source_hash:report.sourceHash,p_fetched_at:report.fetchedAt,p_lead:prepared.lead,p_event:prepared.event,p_log:prepared.log,p_request_hash:prepared.requestHash});
    if(result.error)return {status:result.error.code==='55P03'?409:500,body:{error:result.error.code==='55P03'?'contract_create_busy':'contract_create_failed',code:result.error.code}};
    return {status:result.data?.ok?200:409,body:result.data};
  }catch(e){const code=String(e?.message||'');return {status:409,body:{error:/^(contract_|sheet_)[a-z_]+$/.test(code)?code:'contract_create_failed'}};}
}
