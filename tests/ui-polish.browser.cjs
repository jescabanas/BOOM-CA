// Runs the real frontend with local-only fixture data. No remote calls or writes.
// Set PLAYWRIGHT_MODULE to a bundled Playwright package if it is not installed locally.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../frontend');
const output = path.resolve(__dirname, '../../design-previews');

const mockClient = `
const ROLE_HOME = {super_admin:'admin.html',barangay_secretary:'secretary.html'};
const ROLE_LABEL = {super_admin:'Super Administrator',barangay_secretary:'Barangay Secretary'};
const secretary = location.pathname.endsWith('secretary.html');
const fixtureProfile = {id:'tester',full_name:secretary?'Mayao Parada':'Marc Gloriosow',email:'test@example.invalid',phone:'',role:secretary?'barangay_secretary':'super_admin',is_active:true,barangay_id:'b1',barangays:{name:'Mayao Parada'}};
const fixtureNow = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'numeric'}).formatToParts(fixtureNow).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
const fixturePeriods = ['Weekly','Monthly','Quarterly','Annual','Periodical'].map((frequency,i)=>({id:'p'+i,title:frequency+' Compliance',period_label:frequency==='Weekly'?'Week 1 — '+new Intl.DateTimeFormat('en',{timeZone:'Asia/Manila',month:'long'}).format(fixtureNow):frequency,deadline_schedule_id:frequency==='Periodical'?null:'s'+i,compliance_year:parts.year,occurrence_key:parts.year+'-'+String(parts.month).padStart(2,'0')+'-01',starts_at:new Date(fixtureNow-86400000).toISOString(),deadline_at:new Date(+fixtureNow+86400000).toISOString(),grace_period_hours:24,is_open:true}));
const fixtureSchedules = fixturePeriods.filter(p=>p.deadline_schedule_id).map((p,i)=>({id:p.deadline_schedule_id,title:p.title,frequency:['Weekly','Monthly','Quarterly','Annual'][i]}));
const fixtureSubmissions = [];
if (location.search.includes('late-fixture')) {
 const day = parts.year+'-'+String(parts.month).padStart(2,'0')+'-03';
 Object.assign(fixturePeriods[0],{starts_at:day+'T00:00:00+08:00',deadline_at:day+'T17:00:00+08:00',grace_period_hours:48});
 fixtureSubmissions.push({id:'late-record',compliance_period_id:'p0',barangay_id:'b1',status:'under_review',submitted_at:day+'T18:27:38+08:00',last_submitted_at:day+'T18:27:38+08:00',score_band:'grace_period',points_awarded:3});
}
window.fixtureWrites=[];
const supabaseClient = {
 auth:{mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'}})},getSession:async()=>({data:{session:{user:{id:'tester'}}}}),getUser:async()=>({data:{user:{id:'tester'}}}),signOut:async()=>({})},
 rpc:async(name)=>({data:name==='mfa_bootstrap'?{id:'tester',role:fixtureProfile.role,is_active:true,mfa_required:true,access_allowed:true}:name==='create_compliance_submission'?{id:'draft',status:'pending',submission_notes:''}:name==='leaderboard_for_compliance_period'||name==='public_barangay_rankings'?[{current_rank:1,barangay_name:'Mayao Parada'},{current_rank:2,barangay_name:'Talao-talao'},{current_rank:3,barangay_name:'Barangay 1'}]:0}),
 storage:{from:()=>({download:async()=>({data:await(await fetch('/assets/images/DILG-Logo.png')).blob()}),upload:async()=>({}),getPublicUrl:()=>({data:{publicUrl:'/assets/images/DILG-Logo.png'}})})},
 from(table){
  let id,write;
  const rows=()=>table==='submissions'?fixtureSubmissions:table==='profiles'?[fixtureProfile]:table==='compliance_periods'?fixturePeriods:table==='compliance_deadline_schedules'?fixtureSchedules:table==='barangays'?[{id:'b1',name:'Mayao Parada'}]:table==='mandates'?[{id:'m1',title:'Disaster Preparedness',category:'Disaster Preparedness'},{id:'m2',title:'Education Support',category:'Education'},{id:'m3',title:'Health Services',category:'Health'},{id:'m4',title:'Road Clearing',category:'Infrastructure'}]:[];
  const result=single=>({data:write?{id}:single?(rows().find(r=>r.id===id)||rows()[0]||null):rows()});
  const builder={select(){return this},eq(column,value){if(column==='id')id=value;return this},neq(){return this},order(){return this},not(){return this},in(){return this},limit(){return this},update(payload){write=payload;window.fixtureWrites.push({table,payload});return this},insert(payload){write=payload;window.fixtureWrites.push({table,payload});return this},single:async()=>result(true),maybeSingle:async()=>result(true),then(resolve){return Promise.resolve(result(false)).then(resolve)}};
  return builder;
 }
};`;

(async () => {
  // Restrict the server to the frontend directory on a random loopback port.
  const server = http.createServer((req,res) => {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
    const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type':type}); fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila'});
    const origin = 'http://127.0.0.1:'+server.address().port;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({status:200,body:''});
      if (url.pathname.endsWith('/js/supabaseClient.js')) return route.fulfill({contentType:'text/javascript',body:mockClient});
      if (url.pathname.endsWith('/env.js')) return route.fulfill({contentType:'text/javascript',body:''});
      return route.continue();
    });
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(origin+'/deadlines.html');
    await page.locator('.deadline-group-row').first().waitFor();
    const activeColor = await page.locator('.sidebar nav a.active').evaluate(el=>getComputedStyle(el).backgroundColor);
    const groupStyle = await page.locator('.deadline-group-row summary strong').first().evaluate(el=>({size:getComputedStyle(el).fontSize,transform:getComputedStyle(el).textTransform}));
    assert.equal(groupStyle.transform,'uppercase'); assert.ok(parseInt(groupStyle.size)>=18);
    assert.equal(await page.locator('.deadline-group-row summary strong').first().evaluate(el=>getComputedStyle(el).fontFamily),await page.locator('.page-title h1').evaluate(el=>getComputedStyle(el).fontFamily));
    const themeBox = await page.locator('.theme-toggle-mount').boundingBox(), logoutBox = await page.locator('.sidebar-logout').boundingBox();
    assert.ok(logoutBox.y-themeBox.y-themeBox.height>=0 && logoutBox.y-themeBox.y-themeBox.height<=20,'theme switch is immediately above Log Out');
    assert.equal(await page.locator('.user-chip').evaluate(el=>getComputedStyle(el).borderRadius),'10px');
    assert.ok((await page.locator('.user-chip').boundingBox()).height>=60);
    assert.ok((await page.locator('.user-chip').boundingBox()).width>=260,'profile button has room for longer names');
    assert.equal(await page.locator('.deadline-group-row summary strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(47, 32, 36)','light period headings remain readable');
    assert.equal(await page.locator('#deadline-open').count(),0);
    const year = await page.locator('#deadline-filter-year').boundingBox(), add = await page.locator('#new-btn').boundingBox();
    assert.ok(add.x-year.x-year.width < 24, 'new deadline is adjacent to year select');
    await page.screenshot({path:path.join(output,'implemented-deadlines-light.png')});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    assert.equal(await page.locator('.sidebar nav a.active').evaluate(el=>getComputedStyle(el).backgroundColor),activeColor);
    assert.equal(await page.locator('.deadline-group-row summary strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','dark period headings are white');
    await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div id="theme-check" class="analytics-grid"><article class="card analytics-card"><h3>Analytics theme check</h3></article></div>'));
    assert.equal(await page.locator('#theme-check .analytics-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(52, 26, 38)');
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(37, 18, 28)','dark canvas is maroon');
    assert.equal(await page.locator('#deadline-filter-year').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(68, 35, 51)','dark inputs are maroon');
    await page.locator('#theme-check').evaluate(el=>el.remove());
    await page.screenshot({path:path.join(output,'implemented-deadlines-dark.png')});
    await page.locator('#new-btn').click();
    await page.locator('#deadline-modal').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>document.activeElement.id),'close-btn');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'save-btn');
    await page.keyboard.press('Escape');
    await page.locator('#deadline-modal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement.id),'new-btn');
    await page.locator('.deadline-group-row summary').first().click();
    await page.locator('.deadline-month summary').nth(new Date().getMonth()).click();
    await page.locator('button').filter({hasText:/^Edit$/}).first().click();
    await page.locator('#deadline-modal').waitFor({state:'visible'});
    await page.screenshot({path:path.join(output,'implemented-deadline-editor.png')});
    await page.locator('#close-btn').click();
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await page.locator('.profile-trigger').click();
    await page.locator('#profile-modal').waitFor();
    await page.screenshot({path:path.join(output,'implemented-profile.png')});
    await page.locator('#profile-name').fill('Updated Test Name');
    await page.locator('#profile-save').click();
    await page.locator('#profile-modal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>fixtureWrites.at(-1).payload.full_name),'Updated Test Name');

    await page.goto(origin+'/secretary.html');
    await page.locator('.submission-card').first().waitFor();
    assert.equal(await page.locator('.submission-card-actions .deadline-alert').count(),5);
    assert.equal(await page.locator('.submission-meta').first().getByText('Deadline approaching',{exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'implemented-submissions.png')});
    await page.getByRole('button',{name:'Create submission',exact:true}).first().click();
    await page.locator('#submission-modal').waitFor({state:'visible'});
    const checkbox = page.locator('.mov-category-check').first(); await checkbox.check();
    assert.ok(await checkbox.isChecked());
    await page.screenshot({path:path.join(output,'implemented-submission-editor.png')});
    await page.locator('.review-modal-card').evaluate(el=>el.scrollTop=el.scrollHeight);
    const closeRect = await page.locator('#cancel-submission').boundingBox();
    assert.ok(closeRect.y>=0 && closeRect.y+closeRect.height<=1000,'close button remains visible while scrolling');
    await page.locator('#cancel-submission').click();
    await page.locator('#submission-modal').waitFor({state:'hidden'});
    // Actual shared preview keeps its underlying submission open while downloading.
    await page.getByRole('button',{name:'Create submission',exact:true}).first().click();
    await page.evaluate(()=>openDocumentPreview('/assets/images/DILG-Logo.png','DILG-Logo.png'));
    await page.locator('.document-preview-body img').waitFor();
    const downloaded = page.waitForEvent('download');
    await page.locator('.document-preview-download').click(); await downloaded;
    assert.ok(await page.locator('#document-preview-modal').isVisible());
    assert.ok(await page.locator('#submission-modal').isVisible());
    await page.locator('.document-preview-close').click();
    await page.locator('#document-preview-modal').waitFor({state:'hidden'});
    assert.ok(await page.locator('#submission-modal').isVisible());
    await page.keyboard.press('Escape');
    await page.locator('#submission-modal').waitFor({state:'hidden'});

    // The actual page must reject an old same-day score after the exact cutoff.
    await page.goto(origin+'/secretary.html?late-fixture');
    const lateCard = page.locator('.submission-card').first();
    await lateCard.waitFor();
    assert.match(await lateCard.innerText(),/End:.*5:00 PM/);
    assert.match(await lateCard.innerText(),/Submitted:.*6:27 PM/);
    assert.equal(await lateCard.locator('.pill.danger').innerText(),'Submitted late / under review');
    assert.equal(await lateCard.getByText('Submitted on time / under review',{exact:true}).count(),0);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.screenshot({path:path.join(output,'verified-late-submission.png')});

    for (const [file,modal,closeId] of [['admin.html','user-modal','cancel-user'],['evaluator.html','review-modal','cancel-review'],['history.html','history-modal','close-history-modal']]) {
      await page.goto(origin+'/'+file); await page.locator('.profile-trigger').waitFor();
      await page.evaluate(id=>document.getElementById(id).style.display='flex',modal);
      await page.locator('#'+modal).waitFor({state:'visible'});
      const closeButton = page.locator('#'+modal+' .dialog-close');
      assert.equal(await closeButton.count(),1); await closeButton.click();
      await page.locator('#'+modal).waitFor({state:'hidden'});
    }
    // Medal contrast uses a fixed dark ink, not the dark-theme heading color.
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark'; document.querySelector('main').insertAdjacentHTML('beforeend','<span class="rank-badge top-1">1</span><span class="rank-badge top-2">2</span><span class="rank-badge top-3">3</span>')});
    for (const medal of await page.locator('.rank-badge').all()) assert.equal(await medal.evaluate(el=>getComputedStyle(el).color),'rgb(53, 35, 31)');
    await page.setViewportSize({width:390,height:844});
    await page.goto(origin+'/deadlines.html'); await page.locator('.deadline-group-row').first().waitFor();
    await page.evaluate(()=>document.querySelector('.profile-trigger > div:not(.avatar) > div').textContent='Maria Alexandra Dela Cruz Santiago — '+ 'LongName'.repeat(12));
    assert.ok(await page.locator('.user-chip').evaluate(el=>el.scrollWidth<=el.clientWidth),'long profile names wrap inside the button');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page does not overflow horizontally');
    await page.locator('#new-btn').click();
    assert.ok(await page.locator('#close-btn').isVisible());
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+'/deadlines.html'); await page.locator('#theme-toggle-btn').waitFor();
    await page.getByRole('button',{name:'Switch to dark mode'}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    assert.equal(await page.locator('#theme-toggle-btn').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.theme-toggle-track').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(140, 69, 96)');
    await page.screenshot({path:path.join(output,'palette-deadlines-dark.png')});
    await page.getByRole('button',{name:'Switch to light mode'}).click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('bcs-theme')),'light');
    await page.screenshot({path:path.join(output,'palette-deadlines-light.png')});
    const sharedGradient = await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundImage);
    await page.goto(origin+'/index.html');
    assert.equal(await page.locator('.auth-visual').evaluate(el=>getComputedStyle(el).backgroundImage),sharedGradient);
    assert.equal(await page.getByRole('link',{name:'View Public Rankings'}).evaluate(el=>getComputedStyle(el).textDecorationLine),'none');
    assert.ok((await page.getByRole('link',{name:'View Public Rankings'}).evaluate(el=>getComputedStyle(el).backgroundImage)).includes('246, 196, 69'));
    await page.screenshot({path:path.join(output,'palette-sign-in.png')});
    await page.getByRole('link',{name:'View Public Rankings'}).click();
    await page.locator('.public-ranking-row').first().waitFor();
    assert.equal(await page.locator('.public-rankings-header').evaluate(el=>getComputedStyle(el).backgroundImage),sharedGradient);
    assert.equal(await page.locator('.public-ranking-row').first().evaluate(el=>getComputedStyle(el).backgroundImage),sharedGradient);
    await page.screenshot({path:path.join(output,'palette-public-rankings.png')});
    await page.goto(origin+'/reset-password.html');
    assert.ok(await page.locator('.password-brand img').isVisible());
    assert.match(await page.locator('.password-brand').innerText(),/Department of the/i);
    assert.match(await page.locator('.password-brand').innerText(),/Interior and Local Government/i);
    assert.ok(await page.locator('#save-password-btn').isEnabled());
    await page.screenshot({path:path.join(output,'palette-password.png')});
    for (const file of ['index.html','public-leaderboard.html','reset-password.html']) {
      await page.setViewportSize({width:390,height:844});
      await page.goto(origin+'/'+file);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),file+' fits mobile');
    }
    assert.deepEqual(errors,[],'frontend has no uncaught JavaScript errors');
    console.log('PASS: both themes, compact toolbar, mobile width, dialog focus/close/scroll, profile save, warning icons, MOV checklist, preview download retention and medal contrast.');
    console.log('Screenshots: '+output);
    console.log('PASS: matching public/sidebar gradients, gold rankings link, serif headings, profile shape, relocated theme switch, persisted theme and branded password page; public pages fit mobile.');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
