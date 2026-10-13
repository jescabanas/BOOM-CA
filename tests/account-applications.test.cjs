const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
const base=path.resolve(__dirname,'../supabase/functions');
const appId='11111111-1111-4111-8111-111111111111',barangay='22222222-2222-4222-8222-222222222222';
function load(name,db){
 let handler;
 const ctx=vm.createContext({Request,Response,Headers,Blob,File,FormData,TextDecoder,Uint8Array,atob,crypto:require('node:crypto').webcrypto,console:{error(){}},createClient:()=>db,sendAccountEmail:async(db,email,name,redirect)=>{const r=await db.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(r.error)throw r.error;},Deno:{env:{get:()=>undefined},serve:fn=>handler=fn}});
 for(const filename of ['_shared/mfa-authorization.ts','_shared/account-applications.ts',name+'/index.ts']){
  const text=fs.readFileSync(path.join(base,filename),'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
  vm.runInContext(stripTypeScriptTypes(text),ctx);
 }
 return {handler,ctx};
}
function database(options={}){
 const writes=[],calls=[];
 const application={id:appId,full_name:'Juan Dela Cruz',email:'juan@example.invalid',barangay_id:barangay,proof_path:appId+'/proof.pdf',status:'pending',setup_redirect:'https://attacker.invalid/steal',...options.application};
 const db={
  auth:{getUser:async()=>({data:{user:options.unauthorized?null:{id:'admin-id'}},error:null}),admin:{getUserById:async id=>({data:{user:{id,email:options.userMismatch?'wrong@example.invalid':'juan@example.invalid'}},error:null}),createUser:async payload=>{calls.push(['createUser',payload]);return options.createError?{error:{message:'existing email'}}:{data:{user:{id:'new-auth-user'}}};},deleteUser:async id=>{calls.push(['deleteUser',id]);return {error:null};}},resetPasswordForEmail:async(email,payload)=>{calls.push(['setupEmail',email,payload]);return {error:options.emailError?{message:'email unavailable'}:null};}},
  rpc:async(name,payload)=>{if(name==='mfa_bootstrap')return {data:{id:'admin-id',role:options.secretary?'barangay_secretary':'super_admin',is_active:!options.inactive,mfa_required:true,access_allowed:!options.passwordOnly,blocked:false}};calls.push([name,payload]);return {data:name==='consume_account_application_attempt'?!options.limited:name==='secretary_application_account'?{eligible:!options.existingProfile||!!options.removedSecretary,restoration_user_id:options.removedSecretary?'existing-secretary':null}:'new-auth-user',error:name==='finalize_account_application'&&options.finalizeError?{message:'Account state changed'}:null};},
  storage:{from:()=>({upload:async(name,file,payload)=>{calls.push(['upload',name,payload]);return {error:null};},remove:async paths=>{calls.push(['remove',paths]);return {error:null};}})},
  from(table){
   let write=null,where=[];
   const builder={select(){return this;},eq(k,v){where.push([k,v]);return this;},in(){return this;},neq(){return this;},is(){return this;},ilike(){return this;},limit(){return this;},order(){return this;},insert(payload){write=payload;writes.push([table,payload]);return this;},update(payload){write=payload;writes.push([table,payload]);return this;}};
   function result(single){
    if(write)return {data:options.race&&write.status==='approving'?null:{id:appId},error:options.saveError&&write.provisioned_user_id?{message:'Save failed'}:null};
    if(table==='profiles' && where.some(([k])=>k==='id'))return {data:{id:'admin-id',role:options.secretary?'barangay_secretary':'super_admin',is_active:!options.inactive},error:null};
    if(table==='profiles')return {data:options.existingProfile?{id:'existing'}:null,error:null};
    if(table==='account_applications')return {data:options.submitting?(options.duplicate?{id:appId}:null):application,error:null};
    if(table==='barangays')return {data:single?{id:barangay}:[{id:barangay,name:'Mayao Parada'}],error:null};
    return {data:null,error:null};
   }
   builder.single=builder.maybeSingle=async()=>result(true);
   builder.then=resolve=>Promise.resolve(result(false)).then(resolve);
   return builder;
  }
 };
 return {db,writes,calls};
}
function request(body){const token='header.'+Buffer.from(JSON.stringify({sub:'admin-id',aal:'aal2'})).toString('base64url')+'.signature';return new Request('https://example.invalid/function',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function form(file=new File(['%PDF-1.7 fixture'],'proof.pdf',{type:'application/pdf'})){
 const data=new FormData();data.set('full_name','Juan Dela Cruz');data.set('email','JUAN@example.invalid');data.set('barangay_id',barangay);data.set('consent','true');for(const key of ['appointment_letter','authentication_of_office','pds'])data.set(key,file);data.set('setup_redirect','https://attacker.invalid/steal');return new Request('https://example.invalid/function',{method:'POST',body:data});
}
test('valid application stores private proof and a pending request, never an Auth account',async()=>{
 const fixture=database({submitting:true}),{handler}=load('submit-account-application',fixture.db);const response=await handler(form());assert.equal(response.status,200);
 const record=fixture.writes.find(([table])=>table==='account_applications')[1];
 assert.equal(record.email,'juan@example.invalid');assert.equal(record.setup_redirect,'https://dilgtest2.netlify.app/reset-password.html');assert.equal(record.proof_name,'proof.pdf');assert.equal(record.role,undefined);assert.equal(record.password,undefined);
 assert.ok(!fixture.calls.some(([name])=>name==='createUser'));
});
test('executable masquerading as PDF is refused before any database write',async()=>{
 const fixture=database({submitting:true}),{handler}=load('submit-account-application',fixture.db);assert.equal((await handler(form(new File(['<script>bad</script>'],'proof.pdf',{type:'application/pdf'})))).status,400);assert.equal(fixture.writes.length,0);assert.equal(fixture.calls.length,0);
});
test('rate-limited and duplicate submissions do not store another proof or create accounts',async()=>{
 for(const option of [{limited:true},{duplicate:true},{existingProfile:true}]){
  const fixture=database({submitting:true,...option}),{handler}=load('submit-account-application',fixture.db);assert.equal((await handler(form())).status,option.limited?429:200);assert.ok(!fixture.calls.some(([name])=>['upload','createUser'].includes(name)));
 }
});
test('anonymous, inactive and Secretary callers cannot approve',async()=>{
 for(const option of [{unauthorized:true},{inactive:true},{secretary:true},{passwordOnly:true}]){
  const fixture=database(option),{handler}=load('review-account-application',fixture.db);assert.equal((await handler(request({application_id:appId,action:'approve'}))).status,403);assert.equal(fixture.writes.length,0);assert.equal(fixture.calls.length,0);
 }
});
test('approval creates one random-password account, finalizes fixed role and sends allowlisted setup URL',async()=>{
 const fixture=database(),{handler}=load('review-account-application',fixture.db);const response=await handler(request({application_id:appId,action:'approve',role:'super_admin'}));assert.equal(response.status,200);
 const created=fixture.calls.find(([name])=>name==='createUser')[1];assert.equal(created.email,'juan@example.invalid');assert.ok(created.password.length>=64);assert.equal(created.user_metadata.role,undefined);
 assert.equal(fixture.calls.filter(([name])=>name==='createUser').length,1);assert.ok(fixture.calls.some(([name])=>name==='finalize_account_application'));
 assert.equal(fixture.calls.find(([name])=>name==='setupEmail')[2].redirectTo,'https://dilgtest2.netlify.app/reset-password.html');
});
test('concurrent approval loser cannot create a second account',async()=>{
 const fixture=database({race:true}),{handler}=load('review-account-application',fixture.db);assert.equal((await handler(request({application_id:appId,action:'approve'}))).status,409);assert.equal(fixture.calls.length,0);
});
test('denial requires a reason and creates no Auth account or email',async()=>{
 const fixture=database(),{handler}=load('review-account-application',fixture.db);assert.equal((await handler(request({application_id:appId,action:'deny'}))).status,400);
 assert.equal((await handler(request({application_id:appId,action:'deny',reason:'Appointment could not be verified'}))).status,200);
 assert.ok(fixture.writes.some(([,payload])=>payload.status==='denied'));assert.ok(!fixture.calls.some(([name])=>['createUser','setupEmail'].includes(name)));
});
test('SMTP failure leaves an approved account and offers retry, not a second creation',async()=>{
 const fixture=database({emailError:true}),{handler}=load('review-account-application',fixture.db);const response=await handler(request({application_id:appId,action:'approve'}));const body=await response.json();assert.equal(body.status,'approved');assert.equal(body.email_sent,false);
 const retry=database({application:{status:'approved'},emailError:false}),loaded=load('review-account-application',retry.db);assert.equal((await loaded.handler(request({application_id:appId,action:'resend_setup'}))).status,200);assert.ok(!retry.calls.some(([name])=>name==='createUser'));
});
test('existing account failure never overwrites or deletes that account',async()=>{
 const fixture=database({createError:true}),{handler}=load('review-account-application',fixture.db);assert.equal((await handler(request({application_id:appId,action:'approve'}))).status,500);assert.ok(!fixture.calls.some(([name])=>name==='deleteUser'));assert.ok(!fixture.writes.some(([table])=>table==='profiles'));
});
test('a mismatched Auth identity cannot be finalized',async()=>{
 const fixture=database({userMismatch:true}),{handler}=load('review-account-application',fixture.db);assert.equal((await handler(request({application_id:appId,action:'approve'}))).status,500);assert.ok(!fixture.calls.some(([name])=>name==='finalize_account_application'));
});

test('each application document is mandatory before storage or database writes',async()=>{
 for(const missing of ['appointment_letter','authentication_of_office','pds']){
  const fixture=database({submitting:true}),{handler}=load('submit-account-application',fixture.db);
  const data=await form().formData();data.delete(missing);
  const response=await handler(new Request('https://example.invalid/function',{method:'POST',body:data}));
  assert.equal(response.status,400);assert.equal(fixture.calls.length,0);assert.equal(fixture.writes.length,0);
 }
});

test('removed secretary can reapply with original email and fresh documents without regaining access',async()=>{
 const fixture=database({submitting:true,existingProfile:true,removedSecretary:true}),{handler}=load('submit-account-application',fixture.db);
 assert.equal((await handler(form())).status,200);
 const record=fixture.writes.find(([table])=>table==='account_applications')[1];
 assert.equal(record.restoration_user_id,'existing-secretary');assert.equal(record.email,'juan@example.invalid');
 assert.equal(fixture.calls.filter(([name])=>name==='upload').length,3);
 assert.equal(fixture.calls.some(([name])=>name==='createUser'),false);
 assert.equal(fixture.writes.some(([table])=>table==='profiles'),false);
});
test('restoration uses explicit administrator approval and reuses the original authentication identity',async()=>{
 const fixture=database({application:{restoration_user_id:'existing-secretary'}}),{handler}=load('review-account-application',fixture.db);
 assert.equal((await handler(request({application_id:appId,action:'approve'}))).status,409);
 assert.equal(fixture.writes.length,0);
 const response=await handler(request({application_id:appId,action:'restore'}));assert.equal(response.status,200);assert.equal((await response.json()).restored,true);
 assert.equal(fixture.writes.find(([,v])=>v.provisioned_user_id)[1].provisioned_user_id,'existing-secretary');
 assert.equal(fixture.calls.some(([name])=>['createUser','deleteUser'].includes(name)),false);
 assert.equal(fixture.calls.filter(([name])=>name==='finalize_account_application').length,1);
});
test('failed restoration never deletes the existing account and returns the request to review',async()=>{
 for(const options of [{saveError:true},{finalizeError:true},{userMismatch:true}]){
  const fixture=database({...options,application:{restoration_user_id:'existing-secretary'}}),{handler}=load('review-account-application',fixture.db);
  assert.equal((await handler(request({application_id:appId,action:'restore'}))).status,500);
  assert.equal(fixture.calls.some(([name])=>['createUser','deleteUser','setupEmail'].includes(name)),false);
  assert.ok(fixture.writes.some(([,v])=>v.status==='pending'));
 }
});
test('returning applications can be denied even after a failed restoration attempt',async()=>{
 const fixture=database({application:{restoration_user_id:'existing-secretary',provisioned_user_id:'existing-secretary'}}),{handler}=load('review-account-application',fixture.db);
 assert.equal((await handler(request({application_id:appId,action:'deny',reason:'Return appointment not verified'}))).status,200);
 assert.equal(fixture.calls.some(([name])=>['createUser','deleteUser','setupEmail'].includes(name)),false);
});
test('replaying a completed restoration cannot reactivate an account removed again',async()=>{
 const fixture=database({application:{status:'approved',restoration_user_id:'existing-secretary',provisioned_user_id:'existing-secretary'}}),{handler}=load('review-account-application',fixture.db);
 assert.equal((await handler(request({application_id:appId,action:'restore'}))).status,409);
 assert.equal(fixture.calls.length,0);assert.equal(fixture.writes.length,0);
});
