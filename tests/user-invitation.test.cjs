const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/user-invitation.ts'),'utf8').replace('export async function','async function'));
const context=vm.createContext({crypto:globalThis.crypto});vm.runInContext(source,context);
const input={full_name:'Invited User',email:' INVITED@example.invalid ',role:'super_admin',setup_redirect:'https://example.invalid/reset-password.html'};
function fixture(existing=null,options={}){
 const calls=[];
 const db={auth:{admin:{createUser:async args=>{calls.push(['create',args]);return {data:{user:{id:'new'}}};},deleteUser:async id=>{calls.push(['delete',id]);return {};}}},rpc:async(name,args)=>{calls.push([name,args]);return name==='lookup_user_invitation'?{data:existing,error:options.lookupError}:{data:options.fail?null:{success:true,restored:!!existing?.has_profile},error:options.fail?{message:'Assignment refused'}:null};}};
 const send=async(...args)=>{calls.push(['email',...args.slice(1)]);if(options.emailFail)throw new Error('Provider offline');};
 return {calls,run:args=>context.inviteSystemUser(db,'admin',args,send,x=>{if(options.badRedirect)throw Error('Invalid redirect');return x;})};
}
test('new emails can be directly invited only as administrator',async()=>{
 for(const role of ['super_admin']){
  const f=fixture(),result=await f.run({...input,role,barangay_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.equal(result.status,200);assert.equal(result.body.email_sent,true);
  assert.equal(f.calls.find(c=>c[0]==='create')[1].email,'invited@example.invalid');
  const payload=f.calls.find(c=>c[0]==='complete_user_invitation')[1];
  assert.equal(payload.p_role,role);assert.equal(payload.p_barangay_id,null);
  assert.equal(f.calls.at(-1)[0],'email');
 }
});
test('restoration needs explicit selection and preserves the existing authentication identity',async()=>{
 const existing={id:'existing',has_profile:true,is_active:false};
 let f=fixture(existing),result=await f.run(input);
 assert.equal(result.body.code,'ACCOUNT_RESTORATION_REQUIRED');assert.equal(f.calls.length,1);
 for(const role of ['super_admin']){
  f=fixture(existing);result=await f.run({...input,role,restore_existing:true,barangay_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.equal(result.body.restored,true);assert.equal(f.calls.some(c=>c[0]==='create'||c[0]==='delete'),false);
  assert.equal(f.calls.find(c=>c[0]==='complete_user_invitation')[1].p_user_id,'existing');
 }
});
test('active accounts cannot be overwritten or silently promoted by reinvitation',async()=>{
 const f=fixture({id:'active',has_profile:true,is_active:true}),result=await f.run({...input,restore_existing:true});
 assert.equal(result.status,409);assert.match(result.body.error,/already active/);assert.equal(f.calls.length,1);
});
test('authentication-only identities are reused without generating another password',async()=>{
 const f=fixture({id:'auth-only',has_profile:false}),result=await f.run(input);
 assert.equal(result.status,200);assert.equal(f.calls.some(c=>c[0]==='create'),false);
});
test('assignment failure only rolls back identities created by this request',async()=>{
 let f=fixture(null,{fail:true});assert.equal((await f.run(input)).status,409);assert.deepEqual(f.calls.at(-1),['delete','new']);
 f=fixture({id:'existing',has_profile:true,is_active:false},{fail:true});assert.equal((await f.run({...input,restore_existing:true})).status,409);assert.equal(f.calls.some(c=>c[0]==='delete'||c[0]==='email'),false);
});
test('delivery failure reports successful access change and offers a resend',async()=>{
 const f=fixture(null,{emailFail:true}),result=await f.run(input);
 assert.equal(result.status,200);assert.equal(result.body.success,true);assert.equal(result.body.email_sent,false);assert.match(result.body.message,/Resend setup email/);assert.equal(f.calls.some(c=>c[0]==='delete'),false);
});
test('invalid input and account lookup errors fail before creating an account',async()=>{
 for(const value of [{...input,role:'huc_director'},{...input,email:'bad'},{...input,role:'public_user'},{...input,role:'barangay_secretary',barangay_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...input,full_name:''}]){
  const f=fixture();assert.equal((await f.run(value)).status,400);assert.equal(f.calls.length,0);
 }
 const f=fixture(null,{lookupError:{message:'Offline'}});assert.equal((await f.run(input)).status,500);assert.equal(f.calls.length,1);
});
