// Local fixture only. No real accounts, passwords, emails or hosted writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const base=fs.readFileSync(path.join(__dirname,'ui-polish.browser.cjs'),'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture=base+`
const accounts=[{id:'former',full_name:'Former Secretary',email:'former@example.invalid',barangay_id:'b1',barangay_name:'Mayao Parada',is_active:true,access_blocked:false},{id:'replacement',full_name:'New Secretary <img src=x>',email:'replacement@example.invalid',barangay_id:'b1',barangay_name:'Mayao Parada',is_active:false,access_blocked:false}];
window.accessCalls=[];window.passwordCalls=[];window.failAccess=false;window.failPassword=false;
const oldRpc=supabaseClient.rpc,oldFrom=supabaseClient.from.bind(supabaseClient);
supabaseClient.rpc=async(name,args)=>{
 if(name==='list_secretary_access')return {data:accounts.map(a=>({...a}))};
 if(name==='list_system_users')return {data:[fixtureProfile,...accounts.map(a=>({...a,role:'barangay_secretary',barangays:{name:a.barangay_name}}))]};
 if(name==='remove_system_user'){if(failAccess)return {error:{message:'Access update failed'}};accessCalls.push({...args});const a=accounts.find(a=>a.id===args.p_user_id);a.is_active=false;a.access_removed_at=new Date().toISOString();return {data:{success:true}};}
 if(name==='manage_secretary_access'){
  if(failAccess)return {error:{message:'Access update failed'}};
  accessCalls.push({...args});
  if(args.p_action==='assign')accounts.filter(a=>a.barangay_id===args.p_barangay_id).forEach(a=>a.is_active=a.id===args.p_user_id);
  else accounts.find(a=>a.id===args.p_user_id).is_active=false;
  return {data:{success:true}};
 }
 return oldRpc(name,args);
};
supabaseClient.from=table=>table==='barangays'?{select(){return this},order(){return this},eq(){return this},then(resolve){return Promise.resolve({data:[{id:'b1',name:'Mayao Parada',is_active:true},{id:'b2',name:'Talao-talao',is_active:true}]}).then(resolve)}}:oldFrom(table);
supabaseClient.functions={invoke:async(name,{body})=>{passwordCalls.push({name,...body});const account=accounts.find(a=>a.id===body.user_id);account.access_blocked=failPassword;return failPassword?{data:{error:'Protected access remains blocked. Retry after five minutes.'}}:{data:{success:true,message:'Password changed. Previous sessions are blocked.'}};}};
`;
(async()=>{
 const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.fulfill({body:''});if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/admin.html');await page.getByRole('button',{name:'Barangay Access',exact:true}).click();
  await page.locator('#secretary-access-body').getByText('former@example.invalid',{exact:true}).waitFor();
  assert.equal(await page.locator('#secretary-access-body img').count(),0);
  assert.equal(await page.locator('#secretary-access-body input[type=password]').count(),0);
  assert.equal(await page.locator('#secretary-access-body').getByText('Accessed',{exact:true}).count(),1);
  await page.screenshot({path:path.join(output,'secretary-access-light.png')});
  assert.equal(await page.locator('[data-secretary-remove]').count(),0,'removal moved out of Barangay Access');
  const sizes=await page.locator('.secretary-access-actions button').evaluateAll(buttons=>buttons.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})));
  assert.ok(sizes.every(s=>s.width===sizes[0].width&&s.height===sizes[0].height),'password and replacement buttons match sizes');
  await page.getByRole('button',{name:'Users',exact:true}).click();
  assert.equal(await page.locator('[data-action="edit-user"]').count(),0,'Edit removed from Users');
  assert.equal(await page.locator('[data-action="remove-user"][data-id="tester"]').count(),0,'self removal unavailable');
  await page.locator('[data-action="remove-user"][data-id="former"]').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>accessCalls.length),0,'cancel leaves access unchanged');
  await page.evaluate(()=>window.failAccess=true);await page.locator('[data-action="remove-user"][data-id="former"]').click();
  await page.locator('#admin-edit-reason').fill('End of appointment verified');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Access update failed',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-action="remove-user"][data-id="former"]').count(),1,'failed revoke keeps account visible with access');
  await page.evaluate(()=>window.failAccess=false);
  await page.getByRole('button',{name:'Barangay Access',exact:true}).click();
  await page.locator('#secretary-assign').click();await page.locator('#admin-edit-secretary').selectOption('replacement');
  await page.locator('#admin-edit-reason').fill('New appointment and identity verified');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.locator('[data-secretary-password="replacement"]').waitFor();
  assert.equal(await page.locator('[data-secretary-password="former"]').count(),0);
  assert.equal(await page.evaluate(()=>accessCalls[0].p_action),'assign');
  await page.locator('[data-secretary-password="replacement"]').click();
  assert.equal(await page.locator('#admin-edit-password').getAttribute('type'),'password');
  await page.locator('#admin-edit-password').fill('New-secure-password-2026');await page.locator('#admin-edit-confirmation').fill('New-secure-password-2026');
  await page.locator('#admin-edit-reason').fill('Password changed after identity verification');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Password changed. Previous sessions are blocked.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>passwordCalls[0].name),'change-secretary-password');
  assert.equal(await page.evaluate(()=>passwordCalls[0].user_id),'replacement');
  assert.ok(await page.evaluate(()=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes('New-secure-password-2026'))));
  await page.getByRole('button',{name:'Users',exact:true}).click();
  const beforeWidths=await page.locator('.users-table th').evaluateAll(cells=>cells.map(c=>c.getBoundingClientRect().width));
  await page.screenshot({path:path.join(output,'users-before-removal.png')});
  assert.equal(await page.locator('[data-action="remove-user"]').first().evaluate(b=>b.classList.contains('btn-public-rankings')),true,'same orange/gold as public rankings');
  await page.locator('[data-action="remove-user"][data-id="former"]').click();await page.locator('#admin-edit-reason').fill('Former secretary officially removed');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('users-body').textContent.includes('former@example.invalid'));
  const afterWidths=await page.locator('.users-table th').evaluateAll(cells=>cells.map(c=>c.getBoundingClientRect().width));
  assert.deepEqual(afterWidths,beforeWidths,'account removal does not shift columns');
  await page.locator('[data-action="remove-user"][data-id="replacement"]').click();await page.locator('#admin-edit-reason').fill('Replacement appointment has ended');await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('secretary-access-summary').textContent.startsWith('0 '));
  assert.equal(await page.locator('[data-action="remove-user"][data-id="replacement"]').count(),0);
  await page.getByRole('button',{name:'Barangay Access',exact:true}).click();
  assert.doesNotMatch(await page.locator('#secretary-access-body').innerText(),/former@example.invalid|replacement@example.invalid/,'removed accounts disappear from access management');
  await page.locator('#secretary-access-search').fill('replacement@example.invalid');assert.match(await page.locator('#secretary-access-body').innerText(),/No secretary accounts/);
  await page.locator('#secretary-access-search').fill('');
  await page.locator('#secretary-access-filter').selectOption('active');assert.match(await page.locator('#secretary-access-body').innerText(),/No secretary accounts/);
  await page.locator('#secretary-access-filter').selectOption('all');
  await page.locator('#secretary-assign').click();
  assert.equal(await page.locator('#admin-edit-secretary option[value="former"]').count(),0,'removed account cannot be offered as a replacement');
  await page.locator('#admin-edit-barangay').selectOption('b2');
  assert.ok(await page.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),'no successor cannot be assigned');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'access tab fits mobile');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(output,'secretary-access-mobile-dark.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: secretary access tab, email visibility, escaped names, replacement assignment, removal and failure/cancel handling, password change without persistence, search, status filter and mobile layout.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
