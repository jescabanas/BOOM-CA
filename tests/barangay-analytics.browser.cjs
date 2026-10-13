// Real frontend and charts with local fixtures; no production reads or writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend'),output=path.resolve(__dirname,'../../design-previews');
const chartSource=fs.readFileSync(process.env.CHART_JS_SOURCE||'C:/Users/Marc/AppData/Local/Temp/bcs-chart.umd.js','utf8');
const fixture=`
const ROLE_HOME={barangay_secretary:'secretary.html'},ROLE_LABEL={barangay_secretary:'Barangay Secretary'};
const profile={id:'tester',full_name:'Secretary Fixture',email:'test@example.invalid',role:'barangay_secretary',is_active:true,barangay_id:'b1',barangays:{name:'Mayao Parada'}};
window.requests=[];window.failLoad=false;window.emptyLoad=false;
const extraPeriods=location.search.includes('extras=1')?[...['Weekly','Monthly','Quarterly','Semestral','Annual'].map((frequency,index)=>({id:'77777777-7777-4777-8777-'+String(index+1).padStart(12,'0'),title:frequency==='Weekly'?'Administrator Weekly Report 5':'Administrator '+frequency+' addition',period_label:frequency,compliance_year:2026,deadline_at:'2026-10-31T23:59:59+08:00',starts_at:'2026-10-01T00:00:00+08:00',occurrence_key:null,compliance_deadline_schedules:{frequency}})),{id:'88888888-8888-4888-8888-888888888888',title:'November Weekly Addition',period_label:'Weekly',compliance_year:2026,deadline_at:'2026-11-05T23:59:59+08:00',occurrence_key:null}]:[];
const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const date=(day)=>p.year+'-'+p.month+'-'+String(day).padStart(2,'0')+'T10:00:00+08:00';
const snapshot={barangay:{id:'b1',name:'Mayao Parada'},summary:{required_reports:6,submitted_reports:4,not_submitted_reports:2,overdue_reports:1,upcoming_reports:1,advanced_reports:2,on_time_reports:1,late_reports:1,approved_reports:3,pending_reports:1,rejected_reports:0,returned_reports:0,possible_points:30,total_points:13,compliance_rate:43.33,rank:2,ranked_barangays:33},reports:Array.from({length:6},(_,i)=>({id:'p'+i,title:i===0?'Report <img src=x onerror="window.xss=true">':'Monthly Report '+(i+1),period_label:'Fixture month',frequency:i===5?'Weekly':'Monthly',deadline_at:date(20),starts_at:date(1),submission_id:i<4?'s'+i:null,submitted_at:i<4?date(i+2):null,status:i===1?'under_review':i<4?'approved':'not_submitted',timing:['on_time','on_time','grace_period','late','missing','missing'][i],points:[5,5,3,0,0,0][i],overdue:i===4}))};
snapshot.reports[0].submitted_at=new Date(new Date(p.year+'-'+p.month+'-01T10:00:00+08:00')-86400000).toISOString();
Object.assign(snapshot.summary,{not_submitted_reports:1,assessed_reports:5,possible_points:25,compliance_rate:52});
Object.assign(snapshot.reports[5],{status:'upcoming',timing:'upcoming'});
const supabaseClient={auth:{mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'}})},getSession:async()=>({data:{session:{user:{id:'tester'}}}}),getUser:async()=>({data:{user:{id:'tester'}}}),signOut:async()=>({})},
rpc:async(name,args)=>{if(name==='mfa_bootstrap')return {data:{...profile,mfa_required:true,access_allowed:true}};if(name!=='my_barangay_analytics')throw Error('Unexpected RPC '+name);window.requests.push(args);if(window.failLoad)return {error:{message:'Fixture failure'}};if(window.emptyLoad)return {data:{barangay:snapshot.barangay,summary:{...Object.fromEntries(Object.keys(snapshot.summary).map(k=>[k,0])),rank:null,ranked_barangays:33},reports:[]}};return {data:structuredClone(snapshot)};},
from(table){const b={select(){return b},eq(){return b},order(){return b},single:async()=>({data:profile}),then(resolve){return Promise.resolve({data:table==='profiles'?[profile]:table==='compliance_periods'?extraPeriods:[]}).then(resolve)}};return b;}};
`;
(async()=>{
const server=http.createServer((req,res)=>{const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile())return res.writeHead(404).end();res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1100},timezoneId:'Asia/Manila'}),origin='http://127.0.0.1:'+server.address().port;
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.href.includes('chart.umd.js'))return route.fulfill({contentType:'text/javascript',body:chartSource});if(url.origin!==origin)return route.fulfill({body:''});if(url.pathname.endsWith('/js/supabaseClient.js'))return route.fulfill({contentType:'text/javascript',body:fixture});if(url.pathname.endsWith('/env.js'))return route.fulfill({body:''});return route.continue();});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/barangay-analytics.html?barangay_id=b2');
await page.waitForFunction(()=>document.querySelector('[data-metric="submitted_reports"]').textContent==='4');
assert.equal(await page.locator('#analytics-title').textContent(),'Mayao Parada Analytics');assert.equal(await page.locator('#sidebar-nav a.active').textContent(),'Analytics');
assert.equal(await page.locator('#barangay-stat-grid > :first-child [data-metric="rank"]').textContent(),'#2');assert.equal(await page.locator('#barangay-stat-grid [data-metric="compliance_rate"]').count(),0);assert.equal(await page.locator('#barangay-score-rate').textContent(),'52%');assert.equal(await page.locator('#barangay-score-points').textContent(),'13 of 25 possible points');
assert.equal(await page.locator('.barangay-performance-facts [data-metric="late_reports"]').textContent(),'1');assert.notEqual(await page.locator('[data-report-filter="late"]').evaluate(el=>getComputedStyle(el).backgroundImage),await page.locator('[data-report-filter="not_submitted"]').evaluate(el=>getComputedStyle(el).backgroundImage));
assert.deepEqual(await page.evaluate(()=>dashboardCharts.get('barangay-breakdown-chart').data.datasets[0].data),[4,1,1]);
assert.equal(await page.locator('#barangay-reports-body tr').count(),6);assert.equal(await page.locator('#barangay-reports-body img').count(),0);assert.equal(await page.evaluate(()=>window.xss),undefined);
assert.deepEqual(await page.evaluate(()=>Object.keys(window.requests[0]).sort()),['p_period_type','p_period_value']);
const data=await page.evaluate(()=>dashboardCharts.get('barangay-trend-chart').data);
assert.deepEqual(data.datasets.map(d=>d.data.reduce((a,b)=>a+b,0)),[2,1,1]);assert.ok(data.labels.every(s=>!s.includes('Invalid')));assert.ok(data.labels.length>28,'early uploads outside the assigned month remain visible');
for(const [filter,count] of [['late',1],['not_submitted',1],['under_review',1],['submitted',4]]){await page.locator('[data-report-filter="'+filter+'"]').click();assert.equal(await page.locator('#barangay-reports-body tr').count(),count);}
await page.locator('#barangay-report-filter').selectOption('upcoming');assert.equal(await page.locator('#barangay-reports-body tr').count(),1);assert.match(await page.locator('#barangay-reports-body tr').textContent(),/Upcoming/);await page.locator('#barangay-report-filter').selectOption('all');
await page.evaluate(()=>window.scrollTo(0,0));fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'barangay-analytics-light.png'),fullPage:true});
const fits=await page.locator('.barangay-score-card').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));assert.ok(fits.scroll<=fits.height+1,'performance summary does not clip its content');
const fixedHeights=await page.locator('.barangay-performance-grid .analytics-card').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.deepEqual(fixedHeights,[360,360,380]);
const previews=await page.evaluate(()=>JSON.stringify([...dashboardCharts].map(([id,chart])=>[id,chart.data]))),requestCount=await page.evaluate(()=>window.requests.length);
for(const kind of ['trend','breakdown','type']){
 const button=page.locator('[data-expand-barangay-chart="'+kind+'"]');await button.click();await page.locator('.barangay-chart-explorer[open]').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close expanded chart');assert.ok(await page.evaluate(()=>dashboardCharts.has('expanded-barangay-chart')));
 const expanded=await page.locator('#expanded-barangay-chart').boundingBox(),preview=await page.locator('#barangay-'+(kind==='trend'?'trend':kind==='breakdown'?'breakdown':'type')+'-chart').boundingBox();assert.ok(expanded.height>preview.height&&expanded.height*expanded.width>preview.height*preview.width,'expanded graph has more plot area than the fixed preview');
 if(kind==='trend'){
  await page.locator('.barangay-chart-explorer [data-choice="2"]').click();assert.match(await page.locator('.chart-explorer-details').textContent(),/1 reports/);
  await page.waitForFunction(()=>dashboardCharts.get('expanded-barangay-chart').width>400);const point=await page.evaluate(()=>{const c=dashboardCharts.get('expanded-barangay-chart'),i=c.data.datasets[2].data.findIndex(n=>n>0),p=c.getDatasetMeta(2).data[i],bounds=c.canvas.getBoundingClientRect();return {x:bounds.x+p.x,y:bounds.y+p.y};});await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>document.querySelector('[aria-label="Filter submission date"]').value!=='');assert.match(await page.locator('.chart-explorer-details').textContent(),/Monthly Report 4/);
 }
 if(kind==='breakdown'){await page.locator('.barangay-chart-explorer [data-choice="2"]').click();assert.match(await page.locator('.chart-explorer-details').textContent(),/1 reports/);assert.match(await page.locator('.chart-explorer-details').textContent(),/Upcoming/);await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.dispatchEvent(new Event('bcs-theme-change'));});assert.equal(await page.evaluate(()=>dashboardCharts.get('expanded-barangay-chart').options.plugins.legend.labels.color),'#F7DDE0');assert.match(await page.locator('.chart-explorer-details').textContent(),/Upcoming/);await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.dispatchEvent(new Event('bcs-theme-change'));});}
 if(kind==='type'){await page.locator('.barangay-chart-explorer [data-choice="1"]').click();assert.match(await page.locator('.chart-explorer-details').textContent(),/6 reports/);await page.locator('[aria-label="Filter compliance type"]').selectOption('Weekly');assert.match(await page.locator('.chart-explorer-details').textContent(),/1 reports/);}
 await page.screenshot({path:path.join(output,'barangay-expanded-'+kind+'.png')});
 await page.locator('.barangay-chart-explorer .dialog-close').focus();await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Close expanded chart');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.barangay-chart-explorer').count(),0);assert.equal(await page.evaluate(()=>dashboardCharts.has('expanded-barangay-chart')),false);assert.equal(await button.evaluate(el=>el===document.activeElement),true);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
}
assert.equal(await page.evaluate(()=>JSON.stringify([...dashboardCharts].map(([id,chart])=>[id,chart.data]))),previews,'expanded views cannot modify original chart data');assert.equal(await page.evaluate(()=>window.requests.length),requestCount,'exploring authorized data makes no extra API calls');
for(const mode of ['weekly','quarterly','semestral','annual','monthly']){await page.locator('.analytics-period-mode').selectOption(mode);await page.waitForFunction(m=>window.requests.at(-1).p_period_type===m,mode);await page.waitForFunction(()=>document.querySelector('#barangay-performance').getAttribute('aria-busy')==='false');}
await page.locator('.analytics-period-mode').selectOption('weekly');
await page.locator('.analytics-period-month').selectOption('2026-10');
assert.equal(await page.locator('.analytics-period-value option').count(),4,'only the four assigned report weeks exist');
assert.deepEqual(await page.locator('.analytics-period-value option').allTextContents(),['Week 1 (Oct 1 – Oct 7)','Week 2 (Oct 8 – Oct 14)','Week 3 (Oct 15 – Oct 21)','Week 4 (Oct 22 – Oct 31)']);
await page.locator('.analytics-period-value').selectOption('2026-10-22');
await page.waitForFunction(()=>window.requests.at(-1).p_period_value==='2026-10-22');
await page.locator('.analytics-period-month').selectOption('2026-11');
assert.equal(await page.locator('.analytics-period-value').inputValue(),'2026-11-01');
await page.waitForFunction(()=>window.requests.at(-1).p_period_value==='2026-11-01');
await page.locator('.analytics-period-mode').selectOption('monthly');
await page.waitForFunction(()=>document.querySelector('#barangay-performance').getAttribute('aria-busy')==='false');
assert.deepEqual(await page.locator('.barangay-performance-grid .analytics-card').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height)),fixedHeights,'period changes do not change graph sizes');
await page.evaluate(()=>extraPeriods.push({id:'99999999-9999-4999-8999-999999999999',title:'Saved weekly addition <img src=x onerror="window.xss=true">',period_label:'Weekly',compliance_year:2026,deadline_at:'2026-10-31T23:59:59+08:00',occurrence_key:null}));
await page.locator('#barangay-refresh').click();
await page.waitForFunction(()=>!document.querySelector('#barangay-refresh').disabled);
await page.locator('.analytics-period-mode').selectOption('weekly');
await page.locator('.analytics-period-month').selectOption('2026-10');
assert.equal(await page.locator('.analytics-period-value option').count(),5,'Refresh discovers a newly saved deadline');
assert.equal(await page.locator('#barangay-period-filter img').count(),0,'saved labels are escaped');
assert.equal(await page.evaluate(()=>window.xss),undefined);
await page.evaluate(()=>extraPeriods.splice(0));
await page.locator('#barangay-refresh').click();
await page.waitForFunction(()=>document.querySelectorAll('.analytics-period-value option').length===4);
await page.goto(origin+'/barangay-analytics.html?extras=1');
await page.waitForFunction(()=>document.querySelector('[data-metric="submitted_reports"]').textContent==='4');
for(const [index,mode] of ['weekly','monthly','quarterly','semestral','annual'].entries()){
 await page.locator('.analytics-period-mode').selectOption(mode);
 if(mode==='weekly')await page.locator('.analytics-period-month').selectOption('2026-10');
 const additions=page.locator('.analytics-period-value optgroup option');
 assert.equal(await additions.count(),1,'only saved additions for '+mode+' are offered');
 assert.match(await additions.first().textContent(),new RegExp('Administrator '+(mode==='weekly'?'Weekly Report 5':mode[0].toUpperCase()+mode.slice(1)+' addition')));
 const id='77777777-7777-4777-8777-'+String(index+1).padStart(12,'0');
 await page.locator('.analytics-period-value').selectOption(id);
 await page.waitForFunction(id=>window.requests.at(-1).p_period_type==='periodical'&&window.requests.at(-1).p_period_value===id,id);
 assert.equal(await page.locator('.analytics-period-mode').inputValue(),mode,'the saved report stays under its compliance type');
}
await page.locator('.analytics-period-mode').selectOption('weekly');
await page.locator('.analytics-period-month').selectOption('2026-11');
assert.equal(await page.locator('.analytics-period-value optgroup option').count(),1);
assert.match(await page.locator('.analytics-period-value optgroup option').textContent(),/November Weekly Addition/);
assert.doesNotMatch((await page.locator('.analytics-period-value option').allTextContents()).join(' '),/Administrator Weekly Report 5/);
await page.locator('.analytics-period-mode').selectOption('monthly');
await page.waitForFunction(()=>document.querySelector('#barangay-performance').getAttribute('aria-busy')==='false');
await page.evaluate(()=>window.failLoad=true);await page.locator('#barangay-refresh').click();await page.waitForFunction(()=>document.querySelector('#barangay-load-state').textContent.includes('Could not load'));assert.equal(await page.locator('[data-metric="submitted_reports"]').textContent(),'—');assert.equal(await page.evaluate(()=>dashboardCharts.size),0,'failed load cannot leave stale charts');
await page.evaluate(()=>{window.failLoad=false;window.emptyLoad=true;});await page.locator('#barangay-refresh').click();await page.waitForFunction(()=>document.querySelector('[data-metric="required_reports"]').textContent==='0');assert.equal(await page.locator('#barangay-score-rate').textContent(),'0%');assert.equal(await page.locator('#barangay-score-rank').textContent(),'—');assert.match(await page.locator('#barangay-breakdown-note').textContent(),/No requirements/);
assert.deepEqual(await page.locator('.barangay-performance-grid .analytics-card').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height)),fixedHeights);await page.locator('[data-expand-barangay-chart="type"]').click();assert.match(await page.locator('.chart-explorer-details').textContent(),/No matching reports/);await page.keyboard.press('Escape');
await page.evaluate(()=>window.emptyLoad=false);await page.locator('#barangay-refresh').click();await page.waitForFunction(()=>document.querySelector('[data-metric="submitted_reports"]').textContent==='4');
await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.dispatchEvent(new Event('bcs-theme-change'));window.scrollTo(0,0);});await page.screenshot({path:path.join(output,'barangay-analytics-dark.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.dispatchEvent(new Event('bcs-theme-change'));window.scrollTo(0,0);});await page.screenshot({path:path.join(output,'barangay-analytics-mobile.png'),fullPage:true});
await page.locator('[data-expand-barangay-chart="breakdown"]').click();await page.locator('.barangay-chart-explorer [data-choice="1"]').click();assert.match(await page.locator('.chart-explorer-details').textContent(),/1 reports/);assert.ok(await page.locator('.barangay-chart-explorer').evaluate(el=>el.getBoundingClientRect().width<=innerWidth&&el.scrollWidth<=el.clientWidth));await page.screenshot({path:path.join(output,'barangay-expanded-mobile.png')});await page.keyboard.press('Escape');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no page overflow; report table scrolls inside its container');assert.deepEqual(errors,[]);
console.log('PASS: own-barangay analytics counts, escaped rows, filters, real charts, five period types, empty/error recovery, light/dark and mobile layouts.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
