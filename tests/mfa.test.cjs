const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
function serviceFixture(options={}){
 const calls=[];let factors=[{id:'11111111-1111-4111-8111-111111111111',status:'verified'}];
 const client={auth:{mfa:{
  listFactors:async()=>({data:{totp:factors,all:factors}}),
  challenge:async ({factorId})=>{calls.push(['challenge',factorId]);return {data:{id:'challenge'}};},
  verify:async p=>{calls.push(['verify',p.factorId]);if(options.badCode)return {error:{message:'Invalid code'}};factors.push({id:p.factorId,status:'verified'});return {data:{}};},
  unenroll:async({factorId})=>{calls.push(['unenroll',factorId]);if(options.deleteFailure)return {error:{message:'unavailable'}};factors=factors.filter(f=>f.id!==factorId);return {data:{}};},
 },refreshSession:async()=>{calls.push(['refresh']);return {data:{}};}}};
 const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(root,'frontend/js/mfa-service.js'),'utf8'),ctx);
 return {service:ctx.window.createMfaService(client),calls,factors:()=>factors};
}
test('replacement verifies the new authenticator before deleting the old one',async()=>{
 const f=serviceFixture();await f.service.replace('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','123456');
 assert.deepEqual(f.calls.map(c=>c[0]),['challenge','verify','unenroll','refresh']);assert.deepEqual(f.factors().map(f=>f.id),['22222222-2222-4222-8222-222222222222']);
});
test('invalid replacement code keeps the original working authenticator',async()=>{
 const f=serviceFixture({badCode:true});await assert.rejects(f.service.replace('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','123456'));assert.deepEqual(f.factors().map(f=>f.id),['11111111-1111-4111-8111-111111111111']);assert.ok(!f.calls.some(c=>c[0]==='unenroll'));
});
test('removal failure retains both verified authenticators',async()=>{
 const f=serviceFixture({deleteFailure:true});await assert.rejects(f.service.replace('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','123456'));assert.deepEqual(f.factors().map(f=>f.id),['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
});
test('replacement deletion retry is safe and refuses deleting the replacement itself',async()=>{
 const f=serviceFixture();await f.service.replace('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','123456');await f.service.retireOldFactor('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');await assert.rejects(f.service.retireOldFactor('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222'));assert.deepEqual(f.factors().map(f=>f.id),['22222222-2222-4222-8222-222222222222']);
});
test('malformed codes are rejected before any provider calls',async()=>{
 const f=serviceFixture();for(const code of ['12','12345x','1234567'])await assert.rejects(f.service.verify('11111111-1111-4111-8111-111111111111',code));assert.equal(f.calls.length,0);
});
test('malformed factor paths cannot reach the pinned SDK',async()=>{
 const f=serviceFixture();await assert.rejects(f.service.verify('../admin/users','123456'));assert.equal(f.calls.length,0);
});
test('installed SDK 2.49.8 supports provider enrollment/challenge/verify and Admin MFA APIs',async()=>{
 const {createClient}=require('@supabase/supabase-js');
 const id='11111111-1111-4111-8111-111111111111',factor='22222222-2222-4222-8222-222222222222';
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const token=aal=>encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,aal,exp:Math.floor(Date.now()/1000)+3600,amr:aal==='aal2'?[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]:[]})+'.fixture';
 let verified=false;const calls=[];
 const user=()=>({id,email:'fixture@example.invalid',factors:verified?[{id:factor,factor_type:'totp',status:'verified'}]:[]});
 const client=createClient('https://fixture.example.invalid','fixture-anon-key',{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async(url,options={})=>{
   const p=new URL(url).pathname;calls.push([p,options.method||'GET']);let data;
   if(p.endsWith('/user'))data=user();
   else if(p==='/auth/v1/factors'&&options.method==='POST')data={id:factor,type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg"/>',secret:'DUMMYTESTKEY'}};
   else if(p.endsWith('/challenge'))data={id:'33333333-3333-4333-8333-333333333333',expires_at:Math.floor(Date.now()/1000)+300};
   else if(p.endsWith('/verify')){verified=true;data={access_token:token('aal2'),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:user()};}
   else if(p.endsWith('/factors')&&p.includes('/admin/users/'))data=[{id:factor,factor_type:'totp',status:'verified'}];
   else if(options.method==='DELETE')data={id:factor};
   else throw new Error('Unexpected fixture provider route '+p);
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  }}
 });
 await client.auth.setSession({access_token:token('aal1'),refresh_token:'fixture-refresh'});
 const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(root,'frontend/js/mfa-service.js'),'utf8'),ctx);
 const service=ctx.window.createMfaService(client);assert.equal((await service.assurance()).currentLevel,'aal1');
 const enrollment=await service.enroll();assert.equal(enrollment.id,factor);assert.match(enrollment.totp.qr_code,/^data:image\/svg\+xml/);
 await service.verify(factor,'123456');assert.equal((await service.assurance()).currentLevel,'aal2');assert.equal((await service.factors())[0].id,factor);
 assert.equal((await client.auth.admin.mfa.listFactors({userId:id})).data.factors[0].id,factor);
 assert.equal((await client.auth.admin.mfa.deleteFactor({userId:id,id:factor})).error,null);
 assert.ok(calls.some(([p])=>p.endsWith('/challenge')));assert.ok(calls.some(([p])=>p.endsWith('/verify')));
 await client.auth.stopAutoRefresh();
});
function authorizationFixture({aal='aal2',active=true,allowed=true,role='super_admin',providerError=false}={}){
 const id='11111111-1111-4111-8111-111111111111';let calls=[];
 const token='header.'+Buffer.from(JSON.stringify({sub:id,aal})).toString('base64url')+'.signature';
 const ctx=vm.createContext({Request,Response,JSON,atob,createClient:()=>({auth:{getUser:async()=>{calls.push('verified');return {data:{user:{id}},error:providerError?{message:'invalid signature'}:null};}},rpc:async()=>{calls.push('gate');return {data:{id,role,is_active:active,blocked:false,mfa_required:true,access_allowed:allowed}};}}),Deno:{env:{get:()=>''}}});
 const source=fs.readFileSync(path.join(root,'supabase/functions/_shared/mfa-authorization.ts'),'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(source),ctx);
 return {ctx,calls,req:new Request('https://example.invalid',{headers:{Authorization:'Bearer '+token}})};
}
test('protected API rejects a password-only session and accepts verified MFA',async()=>{
 let f=authorizationFixture({aal:'aal1',allowed:true});assert.equal((await f.ctx.requireMfaRequest(f.req)).status,403);
 f=authorizationFixture();assert.equal(await f.ctx.requireMfaRequest(f.req),null);assert.deepEqual(f.calls,['verified','gate']);
});
test('API preserves inactive-account, database and role denials',async()=>{
 for(const options of [{active:false},{allowed:false},{providerError:true}]){const f=authorizationFixture(options);assert.equal((await f.ctx.requireMfaRequest(f.req)).status,403);}
 const f=authorizationFixture({role:'barangay_secretary'});assert.equal(await f.ctx.authorizeSystemRequest(f.req,['super_admin']),null);
});
test('retired Director role cannot pass a protected API gate even with verified MFA',async()=>{
 const f=authorizationFixture({role:'huc_director'});
 assert.equal((await f.ctx.requireMfaRequest(f.req)).status,403);
});
test('every protected Edge Function uses the server gate; public application is explicit exception',()=>{
 for(const name of ['score-submission','generate-report','notify','resend-user-invite'])assert.match(fs.readFileSync(path.join(root,'supabase/functions',name,'index.ts'),'utf8'),/await requireMfaRequest\(req\)/);
 assert.match(fs.readFileSync(path.join(root,'supabase/functions/create-user/index.ts'),'utf8'),/await authorizeSystemRequest\(req, \["super_admin"\]\)/);
 assert.match(fs.readFileSync(path.join(root,'supabase/functions/_shared/account-applications.ts'),'utf8'),/await requireMfaRequest\(req\)/);
 assert.match(fs.readFileSync(path.join(root,'supabase/functions/reset-user-mfa/index.ts'),'utf8'),/authorizeSystemRequest\(req,\["super_admin"\]\)/);
});
test('all protected pages load modular MFA checks; secrets are never application-persisted',()=>{
 for(const name of ['admin','dashboard','deadlines','evaluator','history','rankings','secretary','barangay-analytics'])assert.match(fs.readFileSync(path.join(root,'frontend',name+'.html'),'utf8'),/mfa-session.js/);
 for(const name of ['mfa-service','mfa-ui'])assert.doesNotMatch(fs.readFileSync(path.join(root,'frontend/js',name+'.js'),'utf8'),/localStorage|sessionStorage|console\.|JSON.stringify/);
});
test('administrator reset blocks before deletions, cannot self-reset and stays blocked on partial failure',async()=>{
 const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
 async function run({self=false,passwordOnly=false,partialFailure=false}={}){
  let handler,blocked=false;const calls=[];
  const db={auth:{getUser:async()=>({data:{user:{id:actor}}}),admin:{mfa:{
   listFactors:async()=>({data:{factors:[{id:'old-one'},{id:'old-two'}]}}),
   deleteFactor:async({id})=>{assert.equal(blocked,true);calls.push('delete:'+id);return {error:partialFailure&&id==='old-two'?{message:'unavailable'}:null};}
  }}},rpc:async(name)=>{
   if(name==='mfa_bootstrap')return {data:{id:actor,role:'super_admin',is_active:true,access_allowed:!passwordOnly,mfa_required:true}};
   calls.push(name);if(name==='begin_mfa_reset'){blocked=true;return {data:'operation'};}blocked=false;return {data:null};
  }};
  const ctx=vm.createContext({Request,Response,atob,JSON,createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>handler=fn}});
  for(const file of ['_shared/mfa-authorization.ts','_shared/account-applications.ts','reset-user-mfa/index.ts'])vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions',file),'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'')),ctx);
  const token='header.'+Buffer.from(JSON.stringify({sub:actor,aal:passwordOnly?'aal1':'aal2'})).toString('base64url')+'.signature';
  const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user_id:self?actor:target,reason:'Identity checked against official appointment; ticket 123'})}));
  return {response,calls,blocked};
 }
 let result=await run();assert.equal(result.response.status,200);assert.deepEqual(result.calls,['begin_mfa_reset','delete:old-one','delete:old-two','complete_mfa_reset']);assert.equal(result.blocked,false);
 result=await run({partialFailure:true});assert.equal(result.response.status,503);assert.equal(result.blocked,true);assert.ok(!result.calls.includes('complete_mfa_reset'));
 result=await run({self:true});assert.equal(result.response.status,400);assert.deepEqual(result.calls,[]);
 result=await run({passwordOnly:true});assert.equal(result.response.status,403);assert.deepEqual(result.calls,[]);
});
test('private files require a completed session before authenticated Storage download',async()=>{
 const calls=[];let allowed=false;
 const ctx=vm.createContext({window:{addEventListener(){}},URL,MfaSession:{requireAccess:async()=>allowed?{id:'test'}:null},supabaseClient:{storage:{from:bucket=>({download:async path=>{calls.push([bucket,path]);return {data:new Blob(['fixture'])};}})}},Blob});
 vm.runInContext(fs.readFileSync(path.join(root,'frontend/js/protected-files.js'),'utf8'),ctx);
 await assert.rejects(ctx.window.ProtectedFiles.download('mov-documents','test/proof.pdf'));assert.equal(calls.length,0);
 allowed=true;await ctx.window.ProtectedFiles.download('mov-documents','test/proof.pdf');assert.deepEqual(calls,[['mov-documents','test/proof.pdf']]);
 for(const n of ['evaluator.html','history.html','secretary.html','js/account-applications.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,'frontend',n),'utf8'),/createSignedUrl/);
});
