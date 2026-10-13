// Fixture-only browser verification: never sends email or creates a remote account.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const csp=fs.readFileSync(path.join(root,'../netlify.toml'),'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
const existing=fs.readFileSync(path.join(__dirname,'ui-polish.browser.cjs'),'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture=existing+`
const applications=[
 {id:'11111111-1111-4111-8111-111111111111',full_name:'Juan Dela Cruz',email:'juan@example.invalid',barangay_id:'b1',barangays:{name:'Mayao Parada'},created_at:'2026-10-03T10:00:00Z',status:'pending',proof_path:'one/proof.png',proof_type:'image/png',proof_name:'Appointment.png',authentication_of_office_path:'one/office.png',authentication_of_office_type:'image/png',pds_path:'one/pds.png',pds_type:'image/png'},
 {id:'22222222-2222-4222-8222-222222222222',full_name:'Maria Santos <img src=x onerror=alert(1)>',email:'maria@example.invalid',barangay_id:'b1',barangays:{name:'Talao-talao'},created_at:'2026-10-03T09:00:00Z',status:'pending',proof_path:'two/proof.png',proof_type:'image/png',proof_name:'Official ID.png'},
 {id:'33333333-3333-4333-8333-333333333333',full_name:'Returning Secretary',email:'returning@example.invalid',barangay_id:'b1',barangays:{name:'Mayao Parada'},created_at:'2026-10-07T08:00:00Z',status:'pending',restoration_user_id:'existing-secretary',proof_path:'three/proof.png',proof_type:'image/png',authentication_of_office_path:'three/office.png',authentication_of_office_type:'image/png',pds_path:'three/pds.png',pds_type:'image/png'}
];
window.applicationCalls=[];window.applicationFailure=false;window.proofFailure=false;
const originalFrom=supabaseClient.from.bind(supabaseClient);
supabaseClient.from=function(table){
 if(table!=='account_applications')return originalFrom(table);
 return {select(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:applications,error:null}).then(resolve)}};
};
supabaseClient.functions={invoke:async(name,{body})=>{
 if(window.applicationFailure)return {error:{message:'Fixture failure',context:{json:async()=>({error:'Please try again.'})}}};
 if(name==='submit-account-application'){
  if(body.action==='barangays')return {data:{barangays:[{id:'b1',name:'Mayao Parada'},{id:'b2',name:'Talao-talao'}]}};
  applicationCalls.push({name,full_name:body.get('full_name'),email:body.get('email'),consent:body.get('consent'),documents:['appointment_letter','authentication_of_office','pds'].map(key=>body.get(key).name)});
  return {data:{success:true}};
 }
 applicationCalls.push({name,...body});
 const row=applications.find(a=>a.id===body.application_id);
 if(body.action==='approve'||body.action==='restore'||body.action==='resend_setup'){row.status='approved';row.reviewed_at=new Date().toISOString();row.setup_email_sent_at=new Date().toISOString();return {data:{success:true,status:'approved',restored:!!row.restoration_user_id,email_sent:true}};}
 row.status='denied';row.review_note=body.reason;row.reviewed_at=new Date().toISOString();return {data:{success:true,status:'denied'}};
}};
supabaseClient.storage.from=()=>({download:async()=>window.proofFailure?{error:{message:'Denied'}}:{data:await(await fetch('/assets/images/DILG-Logo.png')).blob()}});
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Security-Policy':csp,'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila'}),origin='http://127.0.0.1:'+server.address().port;
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.fulfill({status:200,body:''});
   if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});
   if(url.pathname.endsWith('/env.js'))return route.fulfill({contentType:'text/javascript',body:''});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/index.html');
  const sign=await page.locator('#submit-btn').boundingBox(),apply=await page.locator('#apply-account-btn').boundingBox(),rank=await page.getByRole('link',{name:'View Public Rankings'}).boundingBox();assert.ok(apply.y>sign.y&&rank.y>apply.y);
  await page.screenshot({path:path.join(output,'account-application-sign-in.png')});
  await page.locator('#apply-account-btn').click();await page.waitForFunction(()=>!document.getElementById('app-submit').disabled);
  assert.equal(await page.locator('#account-application-form input[type=password]').count(),0);
  await page.screenshot({path:path.join(output,'account-application-form.png')});
  await page.locator('#app-full-name').fill('Juan Dela Cruz');await page.locator('#app-email').fill('juan@example.invalid');await page.locator('#app-barangay').selectOption('b1');
  await page.locator('#app-appointment_letter').setInputFiles({name:'appointment.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 fixture')});await page.locator('#app-consent').check();
  await page.locator('#app-submit').click();assert.equal(await page.evaluate(()=>applicationCalls.length),0,'incomplete application is blocked');
  for(const key of ['authentication_of_office','pds'])await page.locator('#app-'+key).setInputFiles({name:key+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 fixture')});
  await page.evaluate(()=>window.applicationFailure=true);await page.locator('#app-submit').click();await page.getByText('Please try again.',{exact:true}).waitFor();assert.ok(await page.locator('#app-submit').isEnabled());
  await page.evaluate(()=>window.applicationFailure=false);await page.locator('#app-submit').click();await page.getByText('Application received',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>applicationCalls[0].consent),'true');assert.equal(await page.evaluate(()=>applicationCalls[0].documents.length),3);await page.locator('#app-done').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'apply-account-btn');
  await page.goto(origin+'/admin.html');await page.locator('#application-pending-count').getByText('3',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Account Applications/}).click();assert.equal(await page.locator('#applications-body tr').count(),3);
  assert.equal(await page.locator('#applications-body img').count(),0,'applicant markup is escaped');
  await page.screenshot({path:path.join(output,'account-applications-admin-list.png')});
  await page.locator('[data-review-application]').first().click();await page.locator('#app-proof-pane img').waitFor();
  await page.waitForFunction(()=>document.querySelector('#app-proof-pane img')?.naturalWidth>0);
  assert.equal(await page.locator('#app-document-tabs button').count(),3);
  for(const label of ['Authentication of office','PDS (Personal Data Sheet)','Appointment letter']){
   await page.locator('#app-document-tabs').getByRole('button',{name:label,exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#app-proof-pane img')?.naturalWidth>0);
  }
  await page.screenshot({path:path.join(output,'account-application-review-light.png')});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:path.join(output,'account-application-review-dark.png')});
  await page.locator('#app-approve').click();await page.locator('#application-review-modal').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('application-pending-count').textContent==='2');
  await page.locator('#application-filter').selectOption('approved');await page.locator('[data-review-application]').click();await page.locator('#app-resend').click();await page.locator('#application-review-modal').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>applicationCalls.filter(c=>c.action==='approve').length),1);assert.equal(await page.evaluate(()=>applicationCalls.filter(c=>c.action==='resend_setup').length),1);
  await page.locator('#application-filter').selectOption('pending');await page.locator('[data-review-application="33333333-3333-4333-8333-333333333333"]').click();
  await page.getByRole('button',{name:'Approve & restore account',exact:true}).waitFor();await page.getByText(/preserves its files, authorship and history/).waitFor();
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(output,'returning-secretary-review.png')});
  await page.evaluate(()=>applicationFailure=true);await page.locator('#app-approve').click();await page.locator('#app-review-message').getByText('Please try again.',{exact:true}).waitFor();assert.equal(await page.locator('#app-deny').isDisabled(),false);
  await page.evaluate(()=>applicationFailure=false);await page.locator('#app-approve').click();await page.locator('#application-review-modal').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('application-pending-count').textContent==='1');
  assert.equal(await page.evaluate(()=>applicationCalls.filter(c=>c.action==='restore').length),1,'returning secretary uses the explicit restoration action');
  await page.locator('#application-filter').selectOption('pending');await page.locator('[data-review-application]').click();await page.locator('#app-deny').click();await page.locator('#app-confirm-denial').click();await page.getByText('Please explain why the application is being denied.').waitFor();
  await page.locator('#app-denial-reason').fill('The appointment document could not be verified.');await page.locator('#app-confirm-denial').click();await page.locator('#application-review-modal').waitFor({state:'hidden'});
  await page.locator('#application-filter').selectOption('denied');await page.locator('[data-review-application]').click();assert.equal(await page.locator('#app-approve').count(),0);await page.getByText('Reason: The appointment document could not be verified.').waitFor();await page.keyboard.press('Escape');
  await page.locator('#application-search').fill('nonexistent');assert.match(await page.locator('#applications-body').innerText(),/No applications match/);
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'/index.html');await page.locator('#apply-account-btn').click();await page.waitForFunction(()=>!document.getElementById('app-submit').disabled);
  assert.ok(await page.locator('.application-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'account-application-mobile.png')});await page.keyboard.press('Escape');assert.equal(await page.locator('#account-application-modal').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: new/returning secretary application form, explicit restoration, approval, denial, email resend, private proof, filtering, escaping, themes and mobile width.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
