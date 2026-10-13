// Browser fixtures only. Setup key/QR here are dummy test data, not credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const base=fs.readFileSync(path.join(__dirname,'ui-polish.browser.cjs'),'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture=base+`
window.mfaCalls=[];let aal='aal1',verified=[],newEnrollment=null;window.badCode=false;
const existing=location.search.includes('existing');if(existing)verified=[{id:'11111111-1111-4111-8111-111111111111',status:'verified',factor_type:'totp',friendly_name:'My phone'}];
if(location.search.includes('manage'))aal='aal2';
supabaseClient.auth.mfa={
 getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:aal,nextLevel:verified.length?'aal2':'aal1'}}),
 listFactors:async()=>({data:{totp:verified,all:[...verified,...(newEnrollment?[newEnrollment]:[])]}}),
 enroll:async()=>{mfaCalls.push('enroll');newEnrollment={id:'22222222-2222-4222-8222-222222222222',status:'unverified',factor_type:'totp',friendly_name:'DILG authenticator fixture'};return {data:{id:'22222222-2222-4222-8222-222222222222',totp:{secret:'EXAMPLEKEYNOTASECRET',qr_code:'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#fff"/><text x="32" y="110" fill="#410e20">TEST QR ONLY</text></svg>'}}};},
 challenge:async()=>({data:{id:'challenge'}}),
 verify:async({factorId})=>{mfaCalls.push('verify');if(window.badCode)return {error:{message:'Invalid code'}};aal='aal2';if(factorId==='22222222-2222-4222-8222-222222222222'){verified.push({...newEnrollment,status:'verified'});newEnrollment=null;}return {data:{}};},
 unenroll:async({factorId})=>{mfaCalls.push('remove:'+factorId);verified=verified.filter(f=>f.id!==factorId);if(newEnrollment?.id===factorId)newEnrollment=null;return {data:{}};}
};
supabaseClient.auth.refreshSession=async()=>({data:{}});
const baseRpc=supabaseClient.rpc;
supabaseClient.rpc=async(name,args)=>name==='mfa_bootstrap'?{data:{id:'tester',role:'super_admin',is_active:true,mfa_required:true,access_allowed:aal==='aal2',blocked:false}}:baseRpc(name,args);
supabaseClient.auth.signInWithPassword=async()=>({data:{user:{id:'tester'}}});
`;
(async()=>{
 const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({channel:'msedge',headless:true});const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.fulfill({body:''});if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/admin.html');await page.waitForURL('**/mfa.html');await page.locator('#mfa-key').getByText('EXAMPLEKEYNOTASECRET',{exact:true}).waitFor();
  assert.equal(await page.locator('#mfa-qr').evaluate(el=>el.complete&&el.naturalWidth>0),true,'provider SVG data URI renders');
  await page.screenshot({path:path.join(output,'totp-enrollment-light.png')});
  await page.evaluate(()=>{localStorage.setItem('bcs-theme','dark');document.documentElement.dataset.theme='dark';});
  await page.screenshot({path:path.join(output,'totp-enrollment-dark.png')});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'totp-enrollment-mobile.png'),fullPage:true});
  await page.locator('#mfa-code').fill('123456');await page.evaluate(()=>window.badCode=true);await page.locator('#mfa-submit').click();await page.getByText(/That code could not be verified/).waitFor();
  assert.equal(await page.locator('#mfa-submit').isEnabled(),true);assert.equal(await page.locator('#mfa-key').textContent(),'EXAMPLEKEYNOTASECRET');
  await page.goto(origin+'/mfa.html?existing=1');await page.locator('#mfa-form').waitFor();assert.equal(await page.locator('#mfa-setup').isHidden(),true);
  await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:path.join(output,'totp-verification.png')});
  await page.goto(origin+'/mfa.html?existing=1&manage=1');await page.locator('#mfa-replace').click();await page.locator('#mfa-key').getByText('EXAMPLEKEYNOTASECRET').waitFor();
  await page.evaluate(()=>window.badCode=true);await page.locator('#mfa-code').fill('123456');await page.locator('#mfa-submit').click();await page.getByText(/That code could not be verified/).waitFor();
  assert.ok(!(await page.evaluate(()=>mfaCalls)).includes('remove:11111111-1111-4111-8111-111111111111'));
  await page.evaluate(()=>window.badCode=false);await page.locator('#mfa-code').fill('123456');await page.locator('#mfa-submit').click();await page.getByText(/Previous authenticator removed/).waitFor();
  const calls=await page.evaluate(()=>mfaCalls);assert.ok(calls.lastIndexOf('verify')<calls.indexOf('remove:11111111-1111-4111-8111-111111111111'));assert.equal(await page.locator('#mfa-key').textContent(),'');
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/mfa|totp|secret|key/i.test(k))),[]);
  assert.deepEqual(errors,[]);console.log('PASS: protected redirect, QR/manual key, light/dark/mobile, invalid-code retry, existing factor, safe replacement and setup-key clearing. Fixtures only.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})();
