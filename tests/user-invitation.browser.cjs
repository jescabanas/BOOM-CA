// Local fixtures only: never creates real users or sends real emails.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const base=fs.readFileSync(path.join(__dirname,'ui-polish.browser.cjs'),'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture=base+`
const SUPABASE_URL=location.origin;
window.invitationRequests=[];window.emailRequests=[];
supabaseClient.auth.getSession=async()=>({data:{session:{access_token:'fixture-token',user:{id:'tester'}}}});
const oldRpc=supabaseClient.rpc,oldFrom=supabaseClient.from.bind(supabaseClient);
supabaseClient.rpc=async(name,args)=>name==='list_system_users'?{data:[fixtureProfile,{id:'active-user',full_name:'Active User',email:'active@example.invalid',role:'super_admin',is_active:true}]}:oldRpc(name,args);
supabaseClient.from=table=>table==='barangays'?{select(){return this},order(){return this},eq(){return this},then(resolve){return Promise.resolve({data:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Test Barangay',is_active:true}]}).then(resolve)}}:oldFrom(table);
supabaseClient.functions={invoke:async(name,{body})=>{emailRequests.push({name,...body});return {data:{success:true}};}};
`;
(async()=>{
 const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.fulfill({body:''});
   if(url.pathname==='/functions/v1/create-user'){
    const input=route.request().postDataJSON(),page=context.pages()[0];await page.evaluate(input=>invitationRequests.push(input),input);
    if(input.email==='removed@example.invalid'&&!input.restore_existing)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Select Restore removed or disabled account.',code:'ACCOUNT_RESTORATION_REQUIRED'})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,restored:input.restore_existing,email_sent:true,message:'Invitation sent'})});
   }
   if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});
   if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/admin.html');await page.locator('[data-action="resend-invite"]').waitFor();
  await page.getByRole('button',{name:'+ New User',exact:true}).click();
  await page.getByLabel('Full name',{exact:true}).fill('New Administrator');await page.getByLabel('Email',{exact:true}).fill('NEW@example.invalid');
  assert.deepEqual(await page.locator('#nu-role option').evaluateAll(options=>options.map(o=>o.value)),['super_admin']);
  assert.equal(await page.locator('#nu-barangay').count(),0);
  await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.locator('#user-modal').waitFor({state:'hidden'});
  let request=await page.evaluate(()=>invitationRequests.at(-1));assert.equal(request.role,'super_admin');assert.equal(request.email,'new@example.invalid');assert.equal(request.restore_existing,false);
  await page.getByRole('button',{name:'+ New User',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill('removed@example.invalid');
  await page.getByLabel('Role',{exact:true}).selectOption('super_admin');
  await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.locator('#user-error').getByText('Select Restore removed or disabled account.',{exact:true}).waitFor();
  assert.equal(await page.locator('#user-modal').isVisible(),true);
  await page.locator('#nu-restore').check();await page.screenshot({path:path.join(output,'invite-or-restore-user.png')});
  await page.getByRole('button',{name:'Send invitation',exact:true}).click();await page.locator('#user-modal').waitFor({state:'hidden'});
  request=await page.evaluate(()=>invitationRequests.at(-1));assert.equal(request.role,'super_admin');assert.equal(request.restore_existing,true);assert.equal('barangay_id' in request,false);
  await page.locator('[data-action="resend-invite"]').click();assert.equal(await page.evaluate(()=>emailRequests.at(-1).name),'resend-user-invite');
  await page.getByRole('button',{name:'+ New User',exact:true}).click();assert.equal(await page.locator('#nu-restore').isChecked(),false,'restoration confirmation resets on reopen');
  await page.getByLabel('Role',{exact:true}).selectOption('super_admin');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.getElementById('user-modal').scrollWidth<=innerWidth),'invitation dialog fits narrow screens');
  assert.deepEqual(errors,[]);
  console.log('PASS: New User only invites administrators, explicitly restores removed accounts, resends email and fits mobile. No real account changes or emails.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
