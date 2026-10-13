const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
function fixture(options={}){
  const calls=[];let handler,blocked=false;
  const db={auth:{getUser:async()=>({data:{user:{id:actor}}}),admin:{updateUserById:async(id,body)=>{assert.equal(blocked,true);calls.push(['password',id,body]);return {error:options.providerFailure?{message:'secret provider details'}:null};}}},
    rpc:async(name,args)=>{
      if(name==='mfa_bootstrap')return {data:{id:actor,role:options.role||'super_admin',is_active:!options.inactive,mfa_required:true,access_allowed:!options.passwordOnly}};
      calls.push([name,args]);
      if(name==='begin_secretary_password_change'){if(options.beginFailure)return {error:{message:'Denied'}};blocked=true;return {data:'operation'};}
      if(options.finishFailure)return {error:{message:'Access removed'}};
      blocked=false;return {};
    }};
  const ctx=vm.createContext({Request,Response,Headers,atob,console,createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>handler=fn}});
  const root=path.resolve(__dirname,'../supabase/functions');
  for(const name of ['_shared/mfa-authorization.ts','_shared/account-applications.ts','change-secretary-password/index.ts']){
    const source=fs.readFileSync(path.join(root,name),'utf8').replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
    vm.runInContext(stripTypeScriptTypes(source),ctx);
  }
  const token='header.'+Buffer.from(JSON.stringify({sub:actor,aal:options.passwordOnly?'aal1':'aal2'})).toString('base64url')+'.signature';
  return {calls,blocked:()=>blocked,request:body=>handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user_id:target,password:'Unique-password-2026',reason:'Appointment handover verified',...body})}))};
}
test('secretary password changes require active Super Administrator MFA before any mutation',async()=>{
  for(const options of [{role:'barangay_secretary'},{role:'huc_director'},{inactive:true},{passwordOnly:true}]){
    const f=fixture(options);assert.equal((await f.request()).status,403);assert.equal(f.calls.length,0);
  }
});
test('password change rejects self-reset, short passwords and insufficient reasons',async()=>{
  for(const body of [{user_id:actor},{password:'short'},{reason:'short'}]){
    const f=fixture();assert.equal((await f.request(body)).status,400);assert.equal(f.calls.length,0);
  }
});
test('password changes block first, update Auth, and release only the matching operation',async()=>{
  const f=fixture(),response=await f.request();assert.equal(response.status,200);assert.equal(f.blocked(),false);
  assert.deepEqual(f.calls.map(call=>call[0]),['begin_secretary_password_change','password','complete_secretary_password_change']);
  assert.equal(f.calls[1][1],target);assert.equal(f.calls[1][2].password,'Unique-password-2026');
  assert.doesNotMatch(await response.text(),/Unique-password|secret provider/);
  for(const call of [f.calls[0],f.calls[2]])assert.doesNotMatch(JSON.stringify(call),/Unique-password/,'audit/database arguments never include a password');
});
test('provider or finalization failure leaves protected access blocked and never exposes password details',async()=>{
  for(const options of [{providerFailure:true},{finishFailure:true}]){
    const f=fixture(options),response=await f.request();assert.equal(response.status,503);assert.equal(f.blocked(),true);
    const text=await response.text();assert.match(text,/remains blocked/);assert.doesNotMatch(text,/Unique-password|secret provider/);
    if(options.providerFailure)assert.equal(f.calls.length,2,'failed password updates cannot unblock access');
  }
});
test('denied password operation never calls the Auth password provider',async()=>{
  const f=fixture({beginFailure:true});assert.equal((await f.request()).status,409);assert.equal(f.calls.length,1);
});
