// Real Chart.js, local fixtures, and no production queries or writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../frontend');
const output = path.resolve(__dirname, '../../design-previews');
const chartSource = fs.readFileSync(process.env.CHART_JS_FILE || 'C:/Users/Marc/AppData/Local/Temp/bcs-chart.umd.js', 'utf8');
const fixtures = `
const ROLE_HOME={super_admin:'admin.html'},ROLE_LABEL={super_admin:'Super Administrator'};
const fixtureProfile={id:'tester',role:'super_admin',is_active:true,full_name:'Maria Alexandra Dela Cruz Santiago',email:'test@example.invalid'};
const fixtureNow=new Date(), fixtureDeadline=fixtureNow.toISOString();
const fixturePeriod={id:'p1',title:'Weekly Compliance',period_label:'Current week',compliance_year:fixtureNow.getFullYear(),deadline_at:fixtureDeadline};
const fixtureBarangays=[{id:'b1',name:'Mayao Parada'},{id:'b2',name:'Talao-talao'},{id:'b3',name:'Barangay 1'}];
const fixtureRows=[['approved','on_time','b1'],['approved','grace_period','b2'],['under_review','late','b3'],['under_review',null,'b1'],['rejected','late','b2']].map(([status,score_band,barangay_id],i)=>({id:'s'+i,compliance_period_id:'p'+i,barangay_id,status,score_band,submitted_at:fixtureDeadline,last_submitted_at:fixtureDeadline,updated_at:fixtureDeadline,compliance_periods:{...fixturePeriod,id:'p'+i},documents:[{id:'d'+i,is_current:true,file_size_bytes:100}]}));
fixtureRows.push(...[1,2,3].map(i=>({id:'empty-draft'+i,compliance_period_id:'draft'+i,barangay_id:'b3',status:'pending',score_band:'late',submitted_at:null,updated_at:fixtureDeadline,compliance_periods:fixturePeriod,documents:[]})));
const fixtureMandates=[{mandate_id:'m1',title:'Health Services',compliant_barangays:1,total_barangays:3},{mandate_id:'m2',title:'Education Support',compliant_barangays:2,total_barangays:3}];
window.fixtureCalls=[];window.fixtureDelay=0;window.fixtureRpcError=false;
const supabaseClient={
auth:{mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'}})},getSession:async()=>({data:{session:{user:{id:'tester'}}}}),getUser:async()=>({data:{user:{id:'tester'}}})},
rpc:async(name,args)=>{window.fixtureCalls.push({name,args});if(name==='analytics_period_barangays_for_mandate'){const delay=window.fixtureDelay;await new Promise(r=>setTimeout(r,delay));return window.fixtureRpcError?{error:{message:'fixture failure'}}:{data:[{barangay_name:args.p_mandate_id==='m1'?'Mayao Parada':'Talao-talao'}]};}return {data:name==='mfa_bootstrap'?{id:'tester',role:'super_admin',is_active:true,mfa_required:true,access_allowed:true}:name==='analytics_period_mandates'?fixtureMandates:name==='analytics_period_rankings'||name==='leaderboard_for_compliance_period'?fixtureBarangays.map((b,i)=>({current_rank:i+1,barangay_id:b.id,barangay_name:b.name,compliance_rate:50,is_compliant:i<2})):[]}},
from(table){let id;const data=()=>table==='profiles'?[fixtureProfile]:table==='barangays'?fixtureBarangays:table==='compliance_periods'?[fixturePeriod]:table==='submissions'?fixtureRows:[];const result=single=>({data:single?(data().find(row=>row.id===id)||data()[0]):data(),count:data().length});return {select(){return this},eq(column,value){if(column==='id')id=value;return this},order(){return this},not(){return this},in(){return this},limit(){return this},single:async()=>result(true),maybeSingle:async()=>result(true),then(resolve){return Promise.resolve(result(false)).then(resolve)}}}
};`;
async function clickElement(page, id, dataset, index, doughnut=false) {
  const coordinates = await page.evaluate(({id,dataset,index,doughnut})=>{
    const chart=Chart.getChart(id), element=chart.getDatasetMeta(dataset).data[index], rect=chart.canvas.getBoundingClientRect();
    let {x,y}=element.getCenterPoint();
    if(doughnut){const angle=(element.startAngle+element.endAngle)/2,radius=(element.innerRadius+element.outerRadius)/2;x=element.x+Math.cos(angle)*radius;y=element.y+Math.sin(angle)*radius;}
    return {x:rect.left+x,y:rect.top+y};
  },{id,dataset,index,doughnut});
  await page.mouse.click(coordinates.x,coordinates.y);
}
(async()=>{
  const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila'});
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.includes('/chart.js@'))return route.fulfill({contentType:'text/javascript',body:chartSource});if(url.origin!==origin)return route.fulfill({body:''});if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixtures});if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});return route.continue();});
    const page=await context.newPage(), errors=[];
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    page.on('pageerror',e=>errors.push(e.message));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(origin+'/dashboard.html');
    await page.waitForFunction(()=>window.Chart&&Chart.getChart('mandate-chart'));
    assert.equal(await page.locator('[data-review-status="pending"] .value').innerText(),'2','three empty drafts do not inflate the two real pending reports');
    assert.equal(await page.evaluate(()=>latestRowsCache.length),5);
    assert.equal(await page.locator('[data-rank-filter="approved"] .value').innerText(),'2','same compliant count as ranking flags');
    assert.equal(await page.evaluate(()=>buildTrends([], 'day', 2026, '', {mode:'weekly',value:'2026-10-01'}).length),7,'weekly trends show seven dates');
    assert.equal(await page.evaluate(()=>buildTrends([], 'day', 2026, '', {mode:'weekly',value:'2026-10-22'}).length),10,'Week 4 includes the remaining October dates');
    assert.equal(await page.locator('[data-expand-chart]').count(),3);
    const totalGradient=await page.locator('[data-rank-filter="all"]').evaluate(el=>getComputedStyle(el).backgroundImage);
    assert.match(totalGradient,/142, 64, 58/,'total barangays use former late-submission maroon');
    assert.match(await page.locator('[data-review-band="late"]').evaluate(el=>getComputedStyle(el).backgroundImage),/233, 74, 55/,'late submissions use former total-barangays red');
    assert.match(await page.locator('[data-review-band="on_time"]').evaluate(el=>getComputedStyle(el).backgroundImage),/24, 122, 85/,'advanced submissions are green');
    assert.match(await page.locator('#stat-grid .accent-success').evaluate(el=>getComputedStyle(el).backgroundImage),/223, 149, 21/,'compliant barangays retain their orange');
    assert.equal(await page.evaluate(()=>Chart.getChart('compliance-pie').data.datasets[0].borderWidth),0);
    assert.ok(await page.evaluate(()=>['trend-chart','mandate-chart','compliance-pie'].every(id=>!Chart.getChart(id).options.events.includes('click'))));
    await clickElement(page,'mandate-chart',0,0);
    assert.equal(await page.locator('.chart-explorer').count(),0);
    assert.equal(await page.evaluate(()=>fixtureCalls.filter(call=>call.name==='analytics_period_barangays_for_mandate').length),0);
    // Public pages stay light while internal pages share the saved system theme.
    const publicTabs=[];
    for(const file of ['index.html','reset-password.html','public-leaderboard.html']){const tab=await context.newPage();await tab.goto(origin+'/'+file);publicTabs.push(tab);}
    await page.getByRole('button',{name:'Switch to dark mode'}).click();
    for(const tab of publicTabs){
      await tab.waitForFunction(()=>localStorage.getItem('bcs-theme')==='dark');
      assert.notEqual(await tab.evaluate(()=>document.documentElement.dataset.theme),'dark');
      assert.notEqual(await tab.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(37, 18, 28)');
      if(await tab.locator('.auth-form').count())assert.notEqual(await tab.locator('.auth-form').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(52, 26, 38)');
    }
    await publicTabs[0].reload();assert.notEqual(await publicTabs[0].evaluate(()=>document.documentElement.dataset.theme),'dark');
    await publicTabs[0].screenshot({path:path.join(output,'public-sign-in-always-light.png')});
    await publicTabs[2].screenshot({path:path.join(output,'public-rankings-always-light.png')});
    await publicTabs[1].screenshot({path:path.join(output,'public-password-always-light.png')});
    await page.screenshot({path:path.join(output,'explorer-dashboard-dark.png')});
    const rankingTab=await context.newPage();
    await rankingTab.goto(origin+'/rankings.html');
    await rankingTab.locator('#ranking-stats .stat-card .value').first().waitFor();
    assert.equal(await rankingTab.locator('#ranking-stats .stat-card').first().evaluate(el=>getComputedStyle(el).backgroundImage),totalGradient,'rankings and analytics barangay totals match');
    assert.match(await rankingTab.locator('[data-ranking-highlight="not-complied"]').evaluate(el=>getComputedStyle(el).backgroundImage),/233, 74, 55/,'not complied is red');
    await rankingTab.screenshot({path:path.join(output,'kpi-rankings-dark.png')});
    await rankingTab.close();
    const previewIds=await page.evaluate(()=>['trend-chart','mandate-chart','compliance-pie'].map(id=>Chart.getChart(id).id));
    await page.getByRole('button',{name:'Expand Compliance Breakdown'}).click();
    await page.locator('.chart-explorer').waitFor();
    assert.equal(await page.locator('.chart-explorer-details h3').innerText(),'COMPLIANT');
    assert.match(await page.locator('.chart-explorer-details').innerText(),/2 distinct/);
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(53, 211, 158)','compliant names are green');
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).fontSize),'17px');
    await clickElement(page,'expanded-dashboard-chart',0,1,true);
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-details h3').textContent==='PENDING');
    assert.match(await page.locator('.chart-explorer-details').innerText(),/Barangay 1/);
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(245, 158, 66)','pending names are orange');
    await page.getByRole('button',{name:'REJECTED · 1',exact:true}).click();
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(241, 91, 108)','rejected names are red');
    assert.match(await page.locator('.chart-explorer-details').innerText(),/Talao-talao/);
    await page.screenshot({path:path.join(output,'explorer-breakdown-dark.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.chart-explorer').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.expandChart),'breakdown');
    assert.deepEqual(await page.evaluate(()=>['trend-chart','mandate-chart','compliance-pie'].map(id=>Chart.getChart(id).id)),previewIds,'expanding/closing does not destroy dashboard charts');
    assert.equal(await page.evaluate(()=>Object.keys(Chart.instances).length),3,'expanded instance is destroyed on close');
    await page.getByRole('button',{name:'Expand Submission Trends'}).click();
    const pointIndex=await page.evaluate(()=>Chart.getChart('expanded-dashboard-chart').data.datasets[0].data.findIndex(value=>value>0));
    await clickElement(page,'expanded-dashboard-chart',0,pointIndex);
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-options select').value!=='');
    assert.match(await page.locator('.chart-explorer-details').innerText(),/Mayao Parada/);
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(53, 211, 158)','advanced names are green');
    await page.getByRole('button',{name:'ON-TIME',exact:true}).click();
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(245, 158, 66)','on-time names are orange');
    await page.getByRole('button',{name:'LATE',exact:true}).click();
    assert.match(await page.locator('.chart-explorer-details').innerText(),/2 submissions/);
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(241, 91, 108)','late names are red');
    assert.match(await page.locator('.chart-detail-item').first().innerText(),/UNDER REVIEW · LATE/);
    await page.screenshot({path:path.join(output,'explorer-trend-dark.png')});
    await page.getByRole('button',{name:'Close expanded chart'}).click();
    await page.getByRole('button',{name:'Expand Compliance by Mandate'}).click();
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-details').textContent.includes('Mayao Parada'));
    assert.equal(await page.locator('.chart-detail-item strong').first().evaluate(el=>getComputedStyle(el).color),'rgb(53, 211, 158)','mandate names are green');
    await clickElement(page,'expanded-dashboard-chart',0,1);
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-details').textContent.includes('Talao-talao'));
    assert.ok(await page.evaluate(()=>fixtureCalls.filter(call=>call.name==='analytics_period_barangays_for_mandate').every(call=>call.args.p_period_type==='monthly')));
    await page.screenshot({path:path.join(output,'explorer-mandate-dark.png')});
    // Ignore a delayed response if another category has already been selected.
    await page.evaluate(()=>window.fixtureDelay=300);
    await page.getByRole('button',{name:'Health Services · 1',exact:true}).click();
    await page.evaluate(()=>window.fixtureDelay=0);
    await page.getByRole('button',{name:'Education Support · 2',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-details').textContent.includes('Talao-talao'));
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,400)));
    assert.equal(await page.locator('.chart-explorer-details h3').innerText(),'Education Support');
    await page.evaluate(()=>window.fixtureRpcError=true);
    await page.getByRole('button',{name:'Health Services · 1',exact:true}).click();
    await page.getByRole('button',{name:'Try again'}).waitFor();
    await page.evaluate(()=>window.fixtureRpcError=false);
    await page.getByRole('button',{name:'Try again'}).click();
    await page.waitForFunction(()=>document.querySelector('.chart-explorer-details').textContent.includes('Mayao Parada'));
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Switch to light mode'}).click();
    for(const tab of publicTabs)await tab.waitForFunction(()=>document.documentElement.dataset.theme!=='dark');
    await page.getByRole('button',{name:'Expand Compliance Breakdown'}).click();
    await page.screenshot({path:path.join(output,'explorer-breakdown-light.png')});
    await page.keyboard.press('Escape');
    await page.goto(origin+'/history.html');
    await page.locator('#history-search').waitFor();
    const search=await page.locator('#history-search').boundingBox(),filters=await page.locator('#history-period-filter').boundingBox();
    assert.ok(Math.abs(search.y+search.height/2-filters.y-filters.height/2)<2,'search aligns with period filters');
    assert.ok(search.x-filters.x-filters.width>=0 && search.x-filters.x-filters.width<=20,'search is beside analytics filters');
    await page.screenshot({path:path.join(output,'explorer-history-header.png')});
    await page.setViewportSize({width:390,height:844});
    await page.goto(origin+'/dashboard.html');await page.waitForFunction(()=>window.Chart&&Chart.getChart('mandate-chart'));
    for(const title of ['Compliance Breakdown','Submission Trends','Compliance by Mandate']){
      await page.getByRole('button',{name:'Expand '+title}).click();
      await page.screenshot({path:path.join(output,'explorer-mobile-'+title.replaceAll(' ','-')+'.png')});
      const overflow=await page.locator('.chart-explorer').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,items:[...el.querySelectorAll('*')].filter(item=>item.getBoundingClientRect().right>el.getBoundingClientRect().right).map(item=>({tag:item.tagName,cls:item.className,width:item.getBoundingClientRect().width}))}));
      assert.ok(overflow.scroll<=overflow.client,'popup fits mobile: '+JSON.stringify(overflow));
      const close=page.getByRole('button',{name:'Close expanded chart'});await close.focus();await page.keyboard.press('Shift+Tab');
      assert.ok(await page.evaluate(()=>document.querySelector('.chart-explorer').contains(document.activeElement)),'keyboard focus remains in popup');
      await page.keyboard.press('Escape');
    }
    await page.evaluate(()=>{latestRowsCache=[];cardsCache={total_barangays:3,compliant_barangays:0,pending_submissions:0,late_submissions:0,rejected_submissions:0};});
    await page.getByRole('button',{name:'Expand Compliance Breakdown'}).click();
    await page.getByRole('button',{name:'PENDING · 0',exact:true}).click();
    assert.match(await page.locator('.chart-explorer-details').innerText(),/No matching/,'zero categories have an honest empty state');
    await page.keyboard.press('Escape');
    await page.goto(origin+'/dashboard.html');await page.waitForFunction(()=>window.Chart&&Chart.getChart('mandate-chart'));
    await page.locator('[data-rank-filter="approved"]').click();
    await page.waitForURL('**/rankings.html?**');await page.locator('.internal-ranking-table').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('filter'),'approved');
    assert.equal(await page.locator('[data-ranking-highlight="complied"] .value').innerText(),'2');
    assert.equal(await page.locator('.ranking-highlight-complied').count(),2,'both approved barangays highlight despite latest pending/rejected reports');
    assert.deepEqual(errors,[]);
    console.log('PASS: real chart clicks and keyboard controls; read-only previews; side-panel categories/counts/names; RPC race/error/retry; modal cleanup; cross-tab persisted themes; search beside period filters; status colors/capitalization; original KPIs; mobile dialogs.');
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
