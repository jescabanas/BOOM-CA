// Loopback-only fixtures: no email is sent and no real password is changed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const mock=`
window.authCalls=[];window.failSave=false;window.needsMfa=sessionStorage.getItem('fixture-factor')==='new';window.mfaVerified=false;window.hasFactors=true;window.failEnrollment=false;window.failSignOut=false;window.enrollment=null;
const ROLE_HOME={},ROLE_LABEL={};
const supabaseClient={functions:{invoke:async(name,options)=>{authCalls.push({method:name,options});return {data:{success:true}};}},auth:{
mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:window.mfaVerified||(!window.needsMfa&&window.hasFactors)?'aal2':'aal1',nextLevel:window.hasFactors?'aal2':'aal1'}}),listFactors:async()=>({data:{totp:window.hasFactors?[{id:sessionStorage.getItem('fixture-factor')==='new'?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111',status:'verified',friendly_name:'Test authenticator'}]:[],all:window.enrollment?[window.enrollment]:[]}}),
enroll:async()=>{authCalls.push({method:'mfa.enroll'});if(window.failEnrollment)return {error:{message:'Provider unavailable'}};window.enrollment={id:'22222222-2222-4222-8222-222222222222',factor_type:'totp',status:'unverified',friendly_name:'DILG authenticator fixture'};return {data:{id:window.enrollment.id,totp:{secret:'EXAMPLEKEYNOTASECRET',qr_code:'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#fff"/><text x="25" y="110" fill="#410e20">TEST QR ONLY</text></svg>'}}};},
unenroll:async()=>{window.enrollment=null;return {data:{}};},challenge:async()=>({data:{id:'fake-challenge'}}),verify:async args=>{authCalls.push({method:'mfa.verify',args});if(args.code!=='123456')return {error:{message:'Invalid authenticator code'}};window.mfaVerified=true;if(args.factorId==='22222222-2222-4222-8222-222222222222'){window.hasFactors=true;window.enrollment=null;sessionStorage.setItem('fixture-factor','new');}return {data:{}};}},
getSession:async()=>({data:{session:location.hash.includes('access_token')||window.verifiedHash||sessionStorage.getItem('fixture-login')?{user:{id:'fake-user'}}:null}}),
getUser:async()=>({data:{user:{id:'fake-user'}}}),
verifyOtp:async args=>{authCalls.push({method:'verifyOtp',args});if(args.token_hash==='invalid')return {error:{message:'invalid'}};window.verifiedHash=true;return {data:{session:{user:{id:'fake-user'}}}};},
updateUser:async args=>{authCalls.push({method:'updateUser',args});return window.failSave?{error:{message:'Please try again'}}:{};},
signOut:async args=>{authCalls.push({method:'signOut',args});if(window.failSignOut)return {error:{message:'Network unavailable'}};sessionStorage.removeItem('fixture-login');return {};},
signInWithPassword:async args=>{authCalls.push({method:'signInWithPassword',args});window.needsMfa=true;window.mfaVerified=false;sessionStorage.setItem('fixture-login','yes');return {data:{user:{id:'fake-user'}}};},
resetPasswordForEmail:async(email,options)=>{authCalls.push({method:'resetPasswordForEmail',email,options});return {};}
},rpc:async name=>{authCalls.push({method:name});return name==='mfa_bootstrap'?{data:{id:'fake-user',role:'barangay_secretary',is_active:true,mfa_required:true,access_allowed:window.mfaVerified,blocked:false}}:{data:[]};},from:()=>({update:()=>({eq:async()=>({data:[]})})})};`;
(async()=>{
  const server=http.createServer((req,res)=>{
    let pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/email-preview'){let template=fs.readFileSync(path.resolve(root,'../supabase/templates/recovery.html'),'utf8').replaceAll('{{ .ConfirmationURL }}','https://example.invalid/auth/verify?token=fake');res.setHeader('Content-Type','text/html');res.end(template);return;}
    if(pathname==='/secretary.html'){res.setHeader('Content-Type','text/html');res.end('<h1>Secretary destination fixture</h1>');return;}
    pathname=pathname.replace(/^\/DILGtest2\/frontend/,'');if(pathname==='/')pathname='/index.html';
    const target=path.resolve(root,'.'+pathname);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1000,height:1000}}),origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='dilgtest2.netlify.app'&&url.pathname==='/assets/images/DILG-Logo.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'assets/images/DILG-Logo.png'))});if(url.origin!==origin)return route.fulfill({body:''});if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:mock});if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});return route.continue();});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/index.html');await page.evaluate(()=>localStorage.setItem('bcs-theme','dark'));
    for(const file of ['index.html','reset-password.html','public-leaderboard.html','mfa.html']){
      await page.goto(origin+'/'+file);assert.notEqual(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
      await page.evaluate(()=>toggleTheme());assert.equal(await page.evaluate(()=>localStorage.getItem('bcs-theme')),'dark');
      assert.notEqual(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    }
    await page.goto(origin+'/DILGtest2/frontend/index.html');
    await page.evaluate(()=>requestPasswordReset('test@example.invalid'));
    assert.equal(await page.evaluate(()=>authCalls[0].method),'resetPasswordForEmail');
    assert.equal(await page.evaluate(()=>authCalls[0].options.redirectTo),origin+'/DILGtest2/frontend/reset-password.html');
    const payload='#access_token=fake&refresh_token=fake-refresh&type=recovery';
    await page.goto(origin+'/'+payload);await page.waitForURL('**/reset-password.html#**');
    await page.waitForFunction(()=>!document.getElementById('save-password-btn').disabled);
    assert.equal(new URL(page.url()).hash,payload);
    await page.goto(origin+'/DILGtest2/frontend/index.html'+payload);await page.waitForURL('**/DILGtest2/frontend/reset-password.html#**');
    await page.goto(origin+'/reset-password.html?token_hash=fake&type=recovery');
    assert.equal(await page.evaluate(()=>authCalls.length),0,'link is not consumed on opening');
    await page.locator('#verify-email-link').click();
    await page.waitForFunction(()=>!document.getElementById('save-password-btn').disabled);
    assert.equal(new URL(page.url()).search,'','verified token removed from URL');
    assert.equal(await page.evaluate(()=>authCalls[0].args.type),'recovery');
    await page.locator('#password').fill('fake-password-123');await page.locator('#confirmPassword').fill('mismatch-123');
    await page.locator('#save-password-btn').click();assert.match(await page.locator('#message').innerText(),/do not match/);
    assert.equal(await page.evaluate(()=>authCalls.filter(c=>c.method==='updateUser').length),0);
    await page.locator('#confirmPassword').fill('fake-password-123');await page.evaluate(()=>window.failSave=true);
    await page.locator('#save-password-btn').click();await page.getByText('Please try again',{exact:true}).waitFor();
    assert.equal(await page.locator('#save-password-btn').isEnabled(),true);
    await page.evaluate(()=>window.failSave=false);await page.locator('#save-password-btn').click();
    await page.getByText('Password and account security are ready. Sign in with your email, new password and authenticator code.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>authCalls.find(c=>c.method==='signOut').args.scope),'local');
    await page.waitForURL('**/index.html');
    await page.goto(origin+'/reset-password.html?token_hash=invalid&type=recovery');
    await page.locator('#verify-email-link').click();
    await page.getByText(/invalid or has expired/).waitFor();assert.equal(await page.locator('#save-password-btn').isDisabled(),true);
    await page.goto(origin+'/reset-password.html?token_hash=fake&type=recovery&purpose=invite');
    await page.evaluate(()=>window.needsMfa=true);
    await page.locator('#verify-email-link').click();
    await page.locator('#recovery-mfa').waitFor({state:'visible'});
    assert.equal(await page.locator('#reset-form h2').innerText(),'Create Your Password');
    await page.locator('#password').fill('new-password-123');await page.locator('#confirmPassword').fill('new-password-123');
    await page.locator('#recovery-code').fill('654321');await page.locator('#save-password-btn').click();
    await page.getByText('Invalid authenticator code',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>authCalls.filter(c=>c.method==='updateUser').length),0);
    await page.locator('#recovery-code').fill('123456');await page.locator('#save-password-btn').click();
    await page.getByText('Password and account security are ready. Sign in with your email, new password and authenticator code.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.mfaVerified),true);
    // Reset while this page is open: the provider's factor list, not stale AAL
    // claims, decides whether the old authenticator is still needed.
    await page.goto(origin+'/reset-password.html?token_hash=fake&type=recovery&purpose=invite');
    await page.evaluate(()=>window.needsMfa=true);await page.locator('#verify-email-link').click();
    await page.locator('#recovery-mfa').waitFor({state:'visible'});
    await page.evaluate(()=>window.hasFactors=false);await page.locator('#check-authenticator-reset').click();
    await page.getByText(/old authenticator is no longer required/).waitFor();
    assert.equal(await page.locator('#recovery-mfa').isHidden(),true);
    await page.locator('#password').fill('replacement-password-123');await page.locator('#confirmPassword').fill('replacement-password-123');
    await page.evaluate(()=>window.failEnrollment=true);await page.locator('#save-password-btn').click();
    await page.getByText(/password is saved. Authenticator setup could not load/).waitFor();
    assert.equal(await page.evaluate(()=>authCalls.filter(c=>c.method==='updateUser').length),1);
    assert.equal(await page.evaluate(()=>authCalls.some(c=>c.method==='signOut')),false);
    await page.evaluate(()=>window.failEnrollment=false);await page.locator('#retry-authenticator-setup').click();
    await page.getByText('Password saved. Set up your new authenticator below.',{exact:true}).waitFor();
    assert.equal(await page.locator('#mfa-qr').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    assert.equal(await page.locator('#password').inputValue(),'');
    const setupCalls=await page.evaluate(()=>authCalls.map(c=>c.method));
    assert.ok(setupCalls.indexOf('updateUser')<setupCalls.indexOf('mfa.enroll'),'password saved before QR enrollment');
    assert.equal(setupCalls.filter(m=>m==='updateUser').length,1,'enrollment retries do not save password again');
    await page.screenshot({path:path.join(output,'password-first-authenticator-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(output,'password-first-authenticator-mobile.png'),fullPage:true});
    await page.locator('#new-authenticator-code').fill('654321');await page.locator('#verify-new-authenticator').click();
    await page.getByText(/That code could not be verified/).waitFor();
    assert.equal(await page.evaluate(()=>authCalls.some(c=>c.method==='signOut')),false,'invalid code cannot finish setup');
    await page.evaluate(()=>window.failSignOut=true);await page.locator('#new-authenticator-code').fill('123456');await page.locator('#verify-new-authenticator').click();
    await page.getByText('Your authenticator is verified. Retry returning to sign in.',{exact:true}).waitFor();
    assert.equal(await page.locator('#mfa-key').textContent(),'','verified setup key cleared even when sign-out needs retry');
    const verifications=await page.evaluate(()=>authCalls.filter(c=>c.method==='mfa.verify').length);
    await page.evaluate(()=>window.failSignOut=false);await page.locator('#verify-new-authenticator').click();
    await page.getByText(/Password and account security are ready/).waitFor();
    assert.equal(await page.evaluate(()=>authCalls.filter(c=>c.method==='mfa.verify').length),verifications,'sign-out retry does not require another setup verification');
    await page.waitForURL('**/index.html');
    await page.locator('#email').fill('secretary@example.invalid');await page.locator('#password').fill('replacement-password-123');await page.locator('#submit-btn').click();
    await page.waitForURL('**/mfa.html');await page.locator('#mfa-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#mfa-setup').isHidden(),true,'fresh sign-in challenges the newly enrolled factor');
    assert.equal(await page.evaluate(()=>authCalls.some(c=>c.method==='log_audit_event')),false,'password-only session does not record protected login');
    await page.locator('#mfa-code').fill('123456');await page.locator('#mfa-submit').click();
    await page.waitForURL('**/secretary.html');
    await page.evaluate(()=>sessionStorage.clear());
    await page.goto(origin+'/#error=access_denied&error_code=otp_expired');await page.waitForURL('**/reset-password.html');
    await page.getByText(/invalid or has expired/).waitFor();assert.equal(await page.locator('#save-password-btn').isDisabled(),true);
    await page.goto(origin+'/reset-password.html');await page.getByText(/invalid or has expired/).waitFor();
    await page.goto(origin+'/email-preview');await page.locator('img').waitFor();
    assert.equal(await page.locator('img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    await page.screenshot({path:path.join(output,'dilg-reset-email-preview.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'dilg-reset-email-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS: recovery links and existing MFA; administrator reset while page is open; password before QR; enrollment/code/sign-out retries; fresh password sign-in then MFA; desktop/mobile. No live messages or credentials changed.');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
