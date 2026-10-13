// Explicit, non-writing smoke checks against the configured public endpoints.
// Rejected forms return before rate limiting, storage, accounts or email.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/env.js'),'utf8'),sandbox);
const {SUPABASE_URL:url,SUPABASE_ANON_KEY:key}=sandbox.window.__ENV__;
const headers={apikey:key,Authorization:'Bearer '+key};
(async()=>{
 const endpoint=url+'/functions/v1/submit-account-application';
 const list=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'barangays'})});
 assert.equal(list.status,200);
 const {barangays}=await list.json();assert.ok(barangays.length>0);
 for(const missing of ['appointment_letter','authentication_of_office','pds']){
  const form=new FormData();
  for(const [name,value] of Object.entries({full_name:'Endpoint Validation',email:'endpoint-validation@example.invalid',barangay_id:barangays[0].id,consent:'true'}))form.set(name,value);
  for(const name of ['appointment_letter','authentication_of_office','pds']){
   if(name===missing)break;
   form.set(name,new Blob(['%PDF-1.7\nfixture'],{type:'application/pdf'}),name+'.pdf');
  }
  const response=await fetch(endpoint,{method:'POST',headers,body:form});
  const result=await response.json();assert.equal(response.status,400,JSON.stringify(result));
  assert.match(result.error,/required/);
 }
 for(const [name,args] of [
  ['update_recurring_compliance_deadline',{p_period_id:'00000000-0000-4000-8000-000000000000',p_starts_at:'2026-01-01T00:00:00+08:00',p_deadline_at:'2026-01-07T23:59:59+08:00',p_grace_period_hours:24}],
  ['revise_submission_document',{p_document_id:'00000000-0000-4000-8000-000000000000',p_replacement:null}],
  ['add_submission_document',{p_submission_id:'00000000-0000-4000-8000-000000000000',p_file:{}}]
 ]){
  const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const result=await response.json();
  assert.notEqual(result.code,'PGRST202',name+' must be available in the API schema');
  assert.ok(response.status===401||response.status===403,JSON.stringify(result));
 }
 console.log('Connected API resolves all three report functions, denies anonymous mutations, and requires all three application documents. No records, uploads, accounts or emails created.');
})().catch(error=>{console.error(error);process.exitCode=1;});
