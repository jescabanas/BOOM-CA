// Non-writing live smoke check using only the configured public key.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/env.js'),'utf8'),sandbox);
const {SUPABASE_URL:url,SUPABASE_ANON_KEY:key}=sandbox.window.__ENV__;
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
(async()=>{
  for(const [name,args] of [['list_system_users',{}],['remove_system_user',{p_user_id:'00000000-0000-4000-8000-000000000000',p_reason:'Anonymous validation only'}],['list_secretary_access',{}],['manage_secretary_access',{p_barangay_id:'00000000-0000-4000-8000-000000000000',p_user_id:'00000000-0000-4000-8000-000000000000',p_action:'remove',p_reason:'Anonymous validation only'}]]){
    const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args)}),result=await response.json();
    assert.notEqual(result.code,'PGRST202',name+' must exist in the API schema');
    assert.ok([401,403].includes(response.status),JSON.stringify(result));
  }
  const response=await fetch(url+'/functions/v1/change-secretary-password',{method:'POST',headers,body:JSON.stringify({user_id:'00000000-0000-4000-8000-000000000000',password:'Anonymous-fixture-only',reason:'Anonymous validation only'})});
  assert.ok([401,403].includes(response.status),await response.text());
  console.log('PASS: live secretary access RPCs and password endpoint exist and deny anonymous requests. No accounts, assignments, passwords or files changed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
