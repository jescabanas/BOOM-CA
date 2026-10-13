// Local-only deadline edits verify view preservation without changing hosted data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../frontend');
const base = fs.readFileSync(path.join(__dirname, 'ui-polish.browser.cjs'), 'utf8').match(/const mockClient = `([\s\S]*?)`;/)[1];
const fixture = base + `
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const calendar=[];
for(const [frequency,schedule,index] of [['Weekly','s0','W'],['Monthly','s1','M']]){
 for(let month=1;month<=12;month++)for(let slot=1;slot<=4;slot++){
  const prefix=parts.year+'-'+String(month).padStart(2,'0');
  calendar.push({id:frequency+'-'+month+'-'+slot,title:months[month-1]+' '+frequency+' Report '+slot,
   period_label:frequency+' Report '+slot+' — '+months[month-1],compliance_year:parts.year,
   occurrence_key:prefix+'-'+index+slot,deadline_schedule_id:schedule,
   starts_at:prefix+'-01T00:00:00+08:00',deadline_at:prefix+'-28T23:59:59+08:00',
   grace_period_hours:48,is_open:true});
 }
}
fixturePeriods.splice(0,fixturePeriods.length,...calendar,...fixturePeriods.slice(2));
window.deadlineSaves=[];window.failSave=false;
const oldRpc=supabaseClient.rpc;
supabaseClient.rpc=async(name,args)=>{
 if(name!=='update_recurring_compliance_deadline')return oldRpc(name,args);
 deadlineSaves.push(args);
 await new Promise(resolve=>setTimeout(resolve,80));
 if(failSave)return {error:{message:'Fixture save failed'}};
 const period=fixturePeriods.find(row=>row.id===args.p_period_id);
 Object.assign(period,{starts_at:args.p_starts_at,deadline_at:args.p_deadline_at,grace_period_hours:args.p_grace_period_hours});
 return {data:null};
};
`;
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Manila' });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.fulfill({ body: '' });
      if (url.pathname.endsWith('/js/supabaseClient.js')) return route.fulfill({ contentType: 'text/javascript', body: fixture });
      if (url.pathname.endsWith('/env.js')) return route.fulfill({ body: '' });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const snapshot = () => page.evaluate(() => ({
      x: scrollX, y: scrollY, open: [...document.querySelectorAll('#body details[open]')].map(el => el.dataset.deadlineKey),
      scroll: Object.fromEntries([...document.querySelectorAll('#body details[data-deadline-key]')].map(el => [el.dataset.deadlineKey, el.querySelector(':scope > .deadline-group-content').scrollLeft]))
    }));
    await page.goto(origin + '/deadlines.html');
    await page.locator('.deadline-group-row').first().waitFor();
    assert.equal(await page.locator('#body details[open]').count(), 0);
    for (const key of ['Weekly', 'Weekly-1', 'Monthly', 'Monthly-1', 'Monthly-10']) {
      await page.locator('[data-deadline-key="' + key + '"] > summary').click();
    }
    const edit = page.locator('[data-deadline-edit="Monthly-10-3"]');
    await edit.scrollIntoViewIfNeeded();
    const before = await snapshot();
    assert.ok(before.y > 700, 'edit occurs well down the page');
    await edit.click();
    await page.locator('#deadline-grace').fill('24');
    await page.getByRole('button', { name: 'Save Deadline', exact: true }).click();
    await page.waitForFunction(() => document.activeElement.dataset.deadlineEdit === 'Monthly-10-3');
    const after = await snapshot();
    assert.deepEqual(after.open, before.open, 'all open groups and months survive the refresh');
    assert.ok(Math.abs(after.y - before.y) <= 2, 'page remains at the same position');
    assert.match(await edit.locator('xpath=ancestor::tr[1]').innerText(), /24 hours/, 'saved deadline is freshly rendered');

    // Failed saves leave the editor and page intact; retry then restores focus.
    await edit.click();
    await page.evaluate(() => { failSave = true; });
    await page.locator('#save-btn').click();
    await page.locator('#form-error').getByText('Fixture save failed').waitFor();
    assert.equal(await page.locator('#deadline-modal').isVisible(), true);
    assert.deepEqual((await snapshot()).open, before.open);
    await page.evaluate(() => { failSave = false; });
    await page.locator('#save-btn').click();
    await page.waitForFunction(() => document.activeElement.dataset.deadlineEdit === 'Monthly-10-3');
    assert.ok(Math.abs((await snapshot()).y - before.y) <= 2);

    // The same refresh behavior applies to all five compliance frequencies.
    for (const [group, id] of [['Weekly', 'Weekly-1-1'], ['Quarterly', 'p2'], ['Semestral', 'p4'], ['Annual', 'p3']]) {
      await page.locator('[data-deadline-key="' + group + '"]').evaluate(el => { el.open = true; });
      const button = page.locator('[data-deadline-edit="' + id + '"]');
      await button.scrollIntoViewIfNeeded();
      const frequencyBefore = await snapshot();
      await button.click();
      await page.locator('#deadline-grace').fill('28');
      await page.locator('#save-btn').click();
      await page.waitForFunction(id => document.activeElement.dataset.deadlineEdit === id, id);
      const frequencyAfter = await snapshot();
      assert.deepEqual(frequencyAfter.open, frequencyBefore.open, group + ' stays expanded');
      assert.ok(Math.abs(frequencyAfter.y - frequencyBefore.y) <= 2, group + ' keeps its position');
    }

    // Horizontal table scrolling on a phone must also stay at the Edit column.
    await page.setViewportSize({ width: 390, height: 844 });
    await edit.scrollIntoViewIfNeeded();
    const narrowBefore = await snapshot();
    assert.ok(narrowBefore.x > 0 || Object.values(narrowBefore.scroll).some(x => x > 0), 'Edit is reached by horizontal scrolling');
    await edit.click();
    await page.locator('#deadline-grace').fill('36');
    await page.locator('#save-btn').click();
    await page.waitForFunction(() => document.activeElement.dataset.deadlineEdit === 'Monthly-10-3');
    const narrowAfter = await snapshot();
    assert.deepEqual(narrowAfter.open, narrowBefore.open);
    assert.deepEqual(narrowAfter.scroll, narrowBefore.scroll);
    assert.ok(Math.abs(narrowAfter.x - narrowBefore.x) <= 2);
    assert.ok(Math.abs(narrowAfter.y - narrowBefore.y) <= 2);

    // Year changes are a new view, rather than carrying the edited year's state.
    await page.locator('#deadline-filter-year').evaluate(el => el.add(new Option('2027', '2027')));
    await page.locator('#deadline-filter-year').selectOption('2027');
    await page.waitForFunction(() => document.querySelectorAll('#body details[open]').length === 0);
    assert.deepEqual(errors, []);
    console.log('PASS: saving preserves expanded sections, page/table scroll, updated values and Edit focus; failed saves retry; year changes reset the view.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
