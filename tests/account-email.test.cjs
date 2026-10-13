const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/_shared/account-email.ts'),'utf8').replace(/^import .*\n/,'').replace('export async function','async function'));
test('invitation and reset emails are distinct, branded and safely escape recipient content',async()=>{
  const mails=[];const context=vm.createContext({URL,Deno:{env:{get:key=>key==='BREVO_API_KEY'?'test-key':'sender@example.invalid'}},setupRedirect:()=> 'https://example.invalid/reset-password.html',fetch:async(url,options)=>{mails.push(JSON.parse(options.body));return {ok:true};}});
  vm.runInContext(source,context);
  const db={rpc:async()=>({data:true}),auth:{admin:{generateLink:async()=>({data:{properties:{hashed_token:'fake-token'}}})}}};
  await context.sendAccountEmail(db,'recipient@example.invalid','<Test Recipient>','ignored','invite');
  await context.sendAccountEmail(db,'recipient@example.invalid','<Test Recipient>','ignored','recovery');
  assert.notEqual(mails[0].subject,mails[1].subject);
  assert.match(mails[0].htmlContent,/Create my password/);assert.match(mails[1].htmlContent,/Reset my password/);
  for(const mail of mails){assert.match(mail.htmlContent,/DILG-Logo.png/);assert.match(mail.htmlContent,/DEPARTMENT OF THE INTERIOR/);assert.match(mail.htmlContent,/&lt;Test Recipient&gt;/);assert.match(mail.htmlContent,/token_hash=fake-token/);assert.doesNotMatch(mail.htmlContent,/<Test Recipient>/);}
  await assert.rejects(context.sendAccountEmail({...db,rpc:async()=>({data:false})},'test@example.invalid','Test','ignored','invite'),/wait/);
  assert.equal(mails.length,2);
});
