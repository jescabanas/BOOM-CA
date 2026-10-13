// Local fixtures exercise UI only; no hosted writes or real credentials.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../frontend'), output = path.resolve(__dirname, '../../design-previews');
const base = fs.readFileSync(path.join(__dirname,'ui-polish.browser.cjs'),'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture = base + `
const rankRows=Array.from({length:60},(_,i)=>({current_rank:i+1,barangay_id:'b'+i,barangay_name:'Barangay '+(i+1),compliance_rate:100-i,is_compliant:i<30}));
const originalRpc=supabaseClient.rpc;
window.revisionCalls=[];window.failRevision=false;window.submissionCalls=0;
let fixtureDocs=[{id:'d1',file_name:'Original.pdf',storage_path:'b1/draft/old.pdf',document_mandates:[{mandate_id:'m1',mandates:{title:'Disaster Preparedness'}}]}];
supabaseClient.rpc=async(name,args)=>{
 if(name==='public_barangay_rankings'||name==='analytics_period_rankings')return {data:rankRows};
 if(name==='submit_compliance_submission'){submissionCalls++;return {data:{}};}
 if(name==='add_submission_document'){if(failRevision)return {error:{message:'Upload save failed'}};fixtureDocs.push({id:'d2',uploaded_at:'2026-10-06T22:28:00+08:00',...args.p_file,document_mandates:[{mandate_id:'m1',mandates:{title:'Disaster Preparedness'}}]});return {data:'d2'};}
 if(name==='revise_submission_document'){revisionCalls.push(args);if(failRevision)return {error:{message:'Revision failed'}};fixtureDocs=args.p_replacement?[{id:'d2',...args.p_replacement,document_mandates:[{mandate_id:'m1',mandates:{title:'Disaster Preparedness'}}]}]:[];return {data:'d2'};}
 return originalRpc(name,args);
};
if(location.pathname.endsWith('history.html'))fixtureSubmissions.push({id:'november-submission',compliance_period_id:'november',barangay_id:'b1',barangays:{name:'November Barangay'},status:'under_review',submitted_at:'2026-10-06T12:00:00+08:00',last_submitted_at:'2026-10-06T12:00:00+08:00',score_band:'on_time',compliance_periods:{title:'November Weekly Report 1',period_label:'Week 1 — November',compliance_year:2026,occurrence_key:'2026-11-W1',deadline_at:'2026-11-07T23:59:59+08:00'}});
if(['evaluator.html','dashboard.html'].some(file=>location.pathname.endsWith(file))){
 const sent={compliance_period_id:'p0',barangay_id:'b1',status:'under_review',submitted_at:new Date().toISOString(),compliance_periods:fixturePeriods[0]};
 fixtureSubmissions.push({...sent,id:'empty-draft',status:'pending',submitted_at:null,barangays:{name:'Empty Draft'},documents:[]},
  {...sent,id:'missing-evidence',barangays:{name:'Missing Evidence'},documents:[]},
  {...sent,id:'archived-evidence',barangays:{name:'Archived Evidence'},documents:[{id:'old',is_current:false,file_size_bytes:100}]},
  {...sent,id:'complete-report',barangays:{name:'Complete Report'},documents:[{id:'current',is_current:true,file_size_bytes:100}]});
}
const originalFrom=supabaseClient.from;
supabaseClient.from=table=>table==='documents'?{select(){return this},eq(){return this},order(){return this},then(resolve){return Promise.resolve({data:fixtureDocs}).then(resolve)}}:originalFrom.call(supabaseClient,table);
supabaseClient.auth.mfa.listFactors=async()=>({data:{totp:[]}});
`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila'});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.includes('/chart.js@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.CHART_JS_FILE||'C:/Users/Marc/AppData/Local/Temp/bcs-chart.umd.js','utf8')});
   if(url.origin!==origin)return route.fulfill({body:''});
   if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});
   if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/index.html');
  await page.locator('#password').fill('fixture-password');
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  assert.equal(await page.locator('#password').getAttribute('type'),'text');
  assert.equal(await page.locator('#password').inputValue(),'fixture-password');
  await page.getByRole('button',{name:'Hide password',exact:true}).click();
  assert.equal(await page.locator('#password').getAttribute('type'),'password');
  assert.equal(await page.locator('.auth-dilg-logo-left').evaluate(el=>el.complete&&el.naturalWidth>0&&el.width===56),true);
  await page.screenshot({path:path.join(output,'compact-sign-in.png')});
  await page.goto(origin+'/reset-password.html');
  assert.equal(await page.getByRole('button',{name:'Show password',exact:true}).count(),2);
  await page.locator('#confirmPassword').fill('fixture-password');
  await page.locator('button[aria-controls="confirmPassword"]').click();
  assert.equal(await page.locator('#confirmPassword').getAttribute('type'),'text');
  assert.equal(await page.locator('#password').getAttribute('type'),'password');

  for(const file of ['public-leaderboard.html','rankings.html']){
   await page.goto(origin+'/'+file);
   if(file==='public-leaderboard.html'){
     await page.locator('.public-ranking-cards').first().waitFor();
     assert.equal(await page.locator('.public-ranking-cards').count(),3);
     assert.equal(await page.locator('.public-ranking-cards tbody tr').count(),60);
     assert.equal(await page.locator('.public-ranking-cards thead').count(),0);
     assert.doesNotMatch(await page.locator('#public-ranking-list').innerText(),/%/);
     assert.equal(await page.locator('.public-back-button').innerText(),'←');
     assert.equal(await page.locator('.public-back-button').evaluate(el=>getComputedStyle(el).right),'28px');
     assert.equal(await page.locator('.public-ranking-cards td').first().evaluate(el=>getComputedStyle(el).fontFamily),await page.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily));
     const rhythm=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.public-ranking-cards tbody tr')];return rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top});
     const baseline=await page.evaluate(()=>{document.querySelectorAll('.public-ranking-cards').forEach(table=>table.classList.remove('public-ranking-cards'));document.querySelectorAll('.public-ranking-table td:first-child').forEach(cell=>cell.textContent=cell.textContent);const rows=[...document.querySelectorAll('.public-ranking-table tbody tr')];return rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top;});
     assert.ok(rhythm>baseline && rhythm-baseline<9,'public cards are only slightly bigger: '+rhythm+' vs '+baseline);
     await page.evaluate(()=>renderPublicRankings());
   }else{
     await page.locator('.internal-ranking-table').waitFor();
     assert.deepEqual(await page.locator('.internal-ranking-table th').allTextContents(),['Rank','Barangay','Compliance rate']);
     assert.equal(await page.locator('.internal-ranking-table tbody tr').count(),60);
     assert.ok(await page.locator('.internal-ranking-table th, .internal-ranking-table td').evaluateAll(cells=>cells.every(el=>getComputedStyle(el).textAlign==='center')));
   }
   await page.screenshot({path:path.join(output,'updated-'+file.replace('.html','.png'))});
   await page.setViewportSize({width:390,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),file+' does not overflow on mobile');
   await page.setViewportSize({width:1440,height:1000});
  }
  await page.goto(origin+'/secretary.html');
  await page.getByRole('button',{name:'Create submission'}).first().click();
  assert.equal(await page.getByRole('button',{name:'Replace',exact:true}).count(),0);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove Original.pdf',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#existing-movs .mov-file-card'));
  await page.getByRole('button',{name:'Submit Compliance',exact:true}).click();
  await page.locator('#submission-error').getByText(/Attach at least one/).waitFor();
  assert.equal(await page.evaluate(()=>submissionCalls),0);
  await page.locator('.mov-file').first().setInputFiles({name:'Corrected.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 fixture')});
  await page.locator('.mov-category-check').first().check();
  await page.evaluate(()=>window.failRevision=true);
  await page.getByRole('button',{name:'Submit Compliance',exact:true}).click();
  await page.locator('#submission-error').getByText(/Upload save failed/).waitFor();
  assert.equal(await page.evaluate(()=>submissionCalls),0);
  await page.evaluate(()=>window.failRevision=false);
  await page.getByRole('button',{name:'Submit Compliance',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('submission-modal').style.display==='none');
  assert.equal(await page.evaluate(()=>submissionCalls),1);
  await page.getByRole('button',{name:'Create submission'}).first().click();
  assert.equal(await page.locator('#existing-movs strong').first().textContent(),'Corrected.pdf');
  const assertFileAlignment=async()=>{
   const bounds=await page.locator('#existing-movs .mov-file-card').first().evaluate(card=>{
    const actions=card.querySelector('.mov-file-actions'),buttons=[...actions.querySelectorAll('button')],time=actions.querySelector('.mov-file-time');
    return {cardRight:card.getBoundingClientRect().right,buttonRight:buttons.filter(button=>getComputedStyle(button).display!=='none').at(-1).getBoundingClientRect().right,timeRight:time.getBoundingClientRect().right,buttonBottom:buttons[0].getBoundingClientRect().bottom,timeTop:time.getBoundingClientRect().top};
   });
   assert.ok(Math.abs(bounds.buttonRight-bounds.timeRight)<1,'buttons and timestamp share the right edge');
   assert.ok(bounds.cardRight-bounds.buttonRight<=20,'file actions sit near the card edge');
   assert.ok(bounds.timeTop>=bounds.buttonBottom,'timestamp sits below the buttons');
  };
  await page.locator('#existing-movs strong').first().evaluate(el=>el.textContent='lucena-city-barangays-rankings-2026-10-05-long-file-name.pdf');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   await assertFileAlignment();
   await page.locator('#existing-movs .mov-remove-button').evaluate(el=>el.style.display='none');
   await assertFileAlignment();
   await page.locator('#existing-movs .mov-remove-button').evaluate(el=>el.style.display='');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(output,'updated-compliance-revision-controls.png')});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove Corrected.pdf',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#existing-movs .mov-file-card'));
  assert.equal((await page.evaluate(()=>revisionCalls)).at(-1).p_document_id,'d2');
  await page.goto(origin+'/history.html?month=10');
  await page.waitForFunction(()=>document.querySelector('#history-body').textContent.includes('No submissions'));
  assert.doesNotMatch(await page.locator('#history-body').innerText(),/November Barangay/);
  await page.locator('.analytics-period-value').selectOption('11');
  await page.locator('#history-body').getByText(/November Weekly Report 1/).waitFor();
  assert.match(await page.locator('#history-body').innerText(),/November Barangay/);
  await page.goto(origin+'/dashboard.html');
  await page.waitForFunction(()=>document.querySelector('[data-review-status="pending"] .value').textContent==='1');
  assert.equal(await page.evaluate(()=>latestRowsCache.length),1,'empty drafts and invalid files stay out of submission charts');
  await page.locator('[data-review-status="pending"]').click();
  await page.waitForURL('**/evaluator.html?**');
  await page.locator('#queue-body').getByText('Complete Report',{exact:true}).waitFor();
  assert.equal(await page.locator('#queue-body tr').count(),1,'drafts and reports without current evidence stay out of Review');
  assert.equal(await page.locator('#status-filter').inputValue(),'pending');
  assert.doesNotMatch(await page.locator('#queue-body').innerText(),/Empty Draft|Missing Evidence|Archived Evidence/);
  assert.deepEqual(errors,[]);
  console.log('Public cards, matching font, arrow, centered internal columns, mobile layout, missing-file blocking, failed upload retry, replacement, assigned-month history and Review draft exclusion passed.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
