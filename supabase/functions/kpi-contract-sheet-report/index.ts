import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeEmployee } from '../_shared/employee-access.mjs';
import { handleSheetReport } from '../_shared/contract-sheet-report.mjs';

const origins = new Set(['https://pockethjs-sketch.github.io','https://pocketkpi.netlify.app','https://view.xn--9i1b674cwc38r6pa.com','http://127.0.0.1:8765','http://localhost:8765']);
const cors = (req:Request) => ({'access-control-allow-origin':origins.has(req.headers.get('origin') || '')?req.headers.get('origin')!:'https://pockethjs-sketch.github.io',
  'access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'GET,OPTIONS',vary:'origin'});
Deno.serve(async(req:Request) => {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors(req)});
  const organizationId=Deno.env.get('KPI_ORGANIZATION_ID') || '';
  const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await handleSheetReport(req,{authorize:async(request:Request)=>{
    let mustChangePassword=false;
    const access=await authorizeEmployee({request,organizationId,
      verifyUser:async(token:string)=>{const result=await supabase.auth.getUser(token);mustChangePassword=result.data?.user?.app_metadata?.pk_password_change===true;return result;},
      findMembership:(org:string,user:string)=>supabase.from('organization_memberships').select('organization_id,user_id,role,state,archived_at').eq('organization_id',org).eq('user_id',user).maybeSingle()});
    return access.ok && mustChangePassword ? {ok:false,status:403,error:'password_change_required'} : access;
  }});
  return new Response(JSON.stringify(result.body),{status:result.status,headers:{...cors(req),'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
});
