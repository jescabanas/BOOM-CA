// Exercise delayed/failing requests against the real pages, with local fixtures only.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../frontend');
const base = fs.readFileSync(path.join(__dirname, 'ui-polish.browser.cjs'), 'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture = base + `
window.rankCalls=[];window.calendarCalls=0;window.exports=[];
window.securityStarted=false;window.securityChecked=false;
const originalRpc=supabaseClient.rpc, originalFrom=supabaseClient.from.bind(supabaseClient);
const rows=[{current_rank:1,barangay_id:'b1',barangay_name:'Mayao Parada',compliance_rate:50,is_compliant:true},
 {current_rank:2,barangay_id:'b2',barangay_name:'Barra',compliance_rate:33.33,is_compliant:true},
 {current_rank:3,barangay_id:'b3',barangay_name:'Barangay 1',compliance_rate:0,is_compliant:false}];
supabaseClient.rpc=async(name,args)=>{
 if(name==='mfa_bootstrap'){
  securityStarted=true;
  await new Promise(resolve=>{window.allowSecurity=resolve});
  securityChecked=true;
  return originalRpc(name,args);
 }
 if(name==='analytics_period_rankings'||name==='public_barangay_rankings'){
  rankCalls.push({name,args,securityChecked});
  if(name==='public_barangay_rankings')return {data:rows};
  return new Promise(resolve=>{rankCalls.at(-1).resolve=resolve});
 }
 return originalRpc(name,args);
};
supabaseClient.from=table=>{
 if(table==='compliance_periods'){
  calendarCalls++;
  // A normal rankings view must not wait for additional deadline options.
  if(!location.search.includes('period='))return {select(){return this},order(){return this},then(resolve){window.finishCalendar=data=>resolve({data})}};
 }
 return originalFrom(table);
};
window.finishRank=(index,options={})=>rankCalls[index].resolve(options.error?{error:{message:'Fixture failure'}}:
 {data:rows.map(row=>({...row,barangay_name:options.label||row.barangay_name}))});
`;
const pdfStub = `window.jspdf={jsPDF:class {
 static API={};
 constructor(){this.internal={pageSize:{getWidth:()=>297,getHeight:()=>210}};this.autoTable=window.jspdf.jsPDF.API.autoTable;}
 setFontSize(){} text(){} setFillColor(){} rect(){} setTextColor(){}
 save(name){exports.push({name,table:window.lastTable});}
}};`;
(async () => {
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ timezoneId: 'Asia/Manila' });
    const origin = 'http://127.0.0.1:' + server.address().port;
    let pdfRequests = 0, tableRequests = 0, failPDF = true, pdfRelease;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/jspdf@')) {
        pdfRequests++;
        if (failPDF) return route.abort('failed');
        await new Promise(resolve => { pdfRelease = resolve; });
        return route.fulfill({ contentType: 'text/javascript', body: pdfStub });
      }
      if (url.pathname.includes('/jspdf-autotable@')) {
        tableRequests++;
        return route.fulfill({ contentType: 'text/javascript', body: 'window.jspdf.jsPDF.API.autoTable=function(table){window.lastTable=table};' });
      }
      if (url.origin !== origin) return route.fulfill({ body: '' });
      if (url.pathname.endsWith('/js/supabaseClient.js')) return route.fulfill({ contentType: 'text/javascript', body: fixture });
      if (url.pathname.endsWith('/env.js')) return route.fulfill({ body: '' });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/rankings.html?analyticsMode=monthly&analyticsValue=10');
    await page.waitForFunction(() => securityStarted);
    assert.equal(await page.evaluate(() => rankCalls.length), 0, 'protected RPC still waits for MFA');
    assert.equal(pdfRequests, 0, 'PDF scripts are absent from initial loading');
    await page.evaluate(() => allowSecurity());
    await page.waitForFunction(() => rankCalls.length === 1);
    assert.equal(await page.evaluate(() => calendarCalls), 1, 'additional deadlines load without blocking normal rankings');
    assert.equal(await page.evaluate(() => rankCalls[0].securityChecked), true);
    assert.deepEqual(await page.evaluate(() => rankCalls[0].args), { p_period_type: 'monthly', p_period_value: '10' });
    await page.evaluate(() => finishRank(0));
    await page.locator('.internal-ranking-table').waitFor();
    assert.equal(pdfRequests + tableRequests, 0, 'rankings render without PDF downloads');
    await page.locator('[data-ranking-highlight="complied"]').click();
    assert.equal(await page.locator('.ranking-highlight-complied').count(), 2);
    await page.locator('[data-ranking-highlight="not-complied"]').click();
    assert.equal(await page.locator('.ranking-highlight-not-complied').count(), 1);
    assert.equal(await page.evaluate(() => rankCalls.length), 1, 'highlighting uses the loaded result');

    // Rapid period changes: out-of-order success/failure may not overwrite newer rows.
    await page.locator('.analytics-period-value').selectOption('11');
    await page.waitForFunction(() => rankCalls.length === 2);
    await page.locator('.analytics-period-value').selectOption('12');
    await page.waitForFunction(() => rankCalls.length === 3);
    await page.evaluate(() => finishRank(2, { label: 'Latest month' }));
    await page.locator('tbody strong').first().getByText('Latest month').waitFor();
    await page.evaluate(() => finishRank(1, { error: true }));
    assert.match(await page.locator('#rankings-body').innerText(), /Latest month/);
    assert.equal(await page.locator('#rankings-pdf').isEnabled(), true);
    await page.locator('.analytics-period-value').selectOption('9');
    await page.waitForFunction(() => rankCalls.length === 4);
    await page.evaluate(() => finishRank(3, { error: true }));
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    assert.equal(await page.locator('#rankings-pdf').isDisabled(), true);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.waitForFunction(() => rankCalls.length === 5);
    await page.evaluate(() => finishRank(4));
    await page.locator('.internal-ranking-table').waitFor();

    // Failed CDN download is retryable; the selected rows survive a filter change.
    await page.locator('#rankings-pdf').click();
    await page.locator('#rankings-pdf-status').getByText(/Could not prepare/).waitFor();
    assert.equal(await page.locator('#rankings-pdf').isEnabled(), true);
    failPDF = false;
    await page.locator('#rankings-pdf').click();
    await page.waitForFunction(() => document.querySelector('#rankings-pdf').disabled);
    await page.locator('.analytics-period-value').selectOption('8');
    await page.waitForFunction(() => rankCalls.length === 6);
    await page.evaluate(() => finishRank(5, { label: 'Changed while exporting' }));
    assert.ok(pdfRelease, 'download waits independently of rankings');
    pdfRelease();
    await page.waitForFunction(() => exports.length === 1);
    assert.equal(await page.evaluate(() => exports[0].table.body[0][1]), 'Mayao Parada');
    const downloadedCount = pdfRequests + tableRequests;
    await page.locator('#rankings-pdf').click();
    await page.waitForFunction(() => exports.length === 2);
    assert.equal(pdfRequests + tableRequests, downloadedCount, 'PDF libraries are reused');

    // Additional choices arrive after the standard ranking has rendered.
    const extraId='77777777-7777-4777-8777-777777777777';
    await page.evaluate(id=>finishCalendar([{id,title:'Saved additional monthly deadline',period_label:'Monthly',compliance_year:2026,deadline_at:'2026-10-31T23:59:59+08:00',occurrence_key:null}]),extraId);
    await page.locator('.analytics-period-value optgroup option').waitFor({state:'attached'});
    assert.equal(await page.evaluate(()=>rankCalls.length),6,'loading options preserves the currently displayed ranking');
    await page.locator('.analytics-period-value').selectOption(extraId);
    await page.waitForFunction(()=>rankCalls.length===7);
    assert.deepEqual(await page.evaluate(()=>rankCalls[6].args),{p_period_type:'periodical',p_period_value:extraId});
    assert.equal(await page.locator('.analytics-period-mode').inputValue(),'monthly');
    await page.evaluate(()=>finishRank(6));
    await page.locator('.internal-ranking-table').waitFor();

    // Keep legacy links to specific report periods functional.
    await page.goto(origin + '/rankings.html?period=p0');
    await page.waitForFunction(() => securityStarted);
    await page.evaluate(() => allowSecurity());
    await page.waitForFunction(() => rankCalls.length === 1);
    assert.equal(await page.evaluate(() => calendarCalls), 1);
    assert.deepEqual(await page.evaluate(() => rankCalls[0].args), { p_period_type: 'periodical', p_period_value: 'p0' });
    await page.evaluate(() => finishRank(0));
    await page.locator('.internal-ranking-table').waitFor();

    // Public rankings share lazy exports without needing any private access check.
    const beforePublic = pdfRequests + tableRequests;
    await page.goto(origin + '/public-leaderboard.html');
    await page.locator('.public-ranking-cards').first().waitFor();
    assert.equal(pdfRequests + tableRequests, beforePublic);
    assert.equal(await page.evaluate(() => calendarCalls), 0);
    assert.equal(await page.evaluate(() => rankCalls.length), 1);
    await page.locator('#public-pdf-btn').click();
    await page.waitForFunction(() => document.querySelector('script[src*="jspdf@"]'));
    // Wait until interception has installed the resolver for this page.
    await new Promise(resolve => setTimeout(resolve, 100));
    pdfRelease();
    await page.waitForFunction(() => exports.length === 1);
    assert.equal(await page.evaluate(() => exports[0].table.body.length), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: initial rankings do not wait for additional deadlines/PDF downloads; auth preserved; highlights make no RPC; latest period wins; errors retry; private/public PDFs work.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
