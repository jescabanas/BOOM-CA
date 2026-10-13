// Read-only live endpoint check using only the application's public key.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/env.js'),'utf8'),sandbox);
const {SUPABASE_URL:url,SUPABASE_ANON_KEY:key}=sandbox.window.__ENV__;
(async()=>{
  const response=await fetch(url+'/rest/v1/rpc/my_barangay_analytics',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_period_type:'annual',p_period_value:'2026'})});
  const result=await response.json();assert.notEqual(result.code,'PGRST202','analytics function must be installed');assert.ok([401,403].includes(response.status),'anonymous access must be denied');
  console.log('PASS: live barangay analytics endpoint exists and denies anonymous access. No accounts, submissions or files changed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
