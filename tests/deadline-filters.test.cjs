const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'frontend/js/period-filter.js'), 'utf8');

test('years begin in 2026 and extend when the Philippine calendar year changes', () => {
  const ctx = vm.createContext({ Intl, Date });
  vm.runInContext(shared, ctx);
  for (const [year, expected] of [[2026, [2026]], [2027, [2027, 2026]], [2030, [2030, 2029, 2028, 2027, 2026]]]) {
    vm.runInContext(`currentComplianceDate = () => ({year:${year},month:1})`, ctx);
    assert.equal(JSON.stringify(vm.runInContext('defaultPeriodYears()', ctx)), JSON.stringify(expected));
  }
});

test('Philippine midnight and schedule type are independent of browser timezone', () => {
  const ctx = vm.createContext({ Intl, Date });
  vm.runInContext(shared, ctx);
  assert.equal(vm.runInContext('currentComplianceDate(new Date("2026-12-31T16:01:00Z")).year', ctx), 2027);
  assert.equal(vm.runInContext('complianceFrequency({deadline_schedule_id:"s",period_label:"October"},{s:{frequency:"Monthly"}})', ctx), 'Monthly');
  assert.equal(vm.runInContext('complianceMonth({occurrence_key:"2026-10-05",deadline_at:"2026-11-02T09:00:00Z"})', ctx), 10);
});

test('year-filtered weekly groups and editing preserve the assigned week', async () => {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', style: {}, checked: false, querySelectorAll: () => [] });
    return elements.get(id);
  }};
  document.getElementById('deadline-filter-year').value = '2026';
  const periods = [
    { id:'w1', title:'Weekly', period_label:'Week 1 — October', deadline_schedule_id:'s', occurrence_key:'2026-10-05', compliance_year:2026, starts_at:'2026-09-30T16:00:00Z', deadline_at:'2026-10-05T09:00:00Z', grace_period_hours:24, is_open:true },
    { id:'next', title:'Future year', period_label:'Week 1 — January', deadline_schedule_id:'s', occurrence_key:'2027-01-04', compliance_year:2027, deadline_at:'2027-01-04T09:00:00Z' },
    ...[3,2,1,4].map(slot=>({id:'m'+slot,title:'January Monthly Report '+slot,period_label:'Monthly Report '+slot+' — January',deadline_schedule_id:'m',occurrence_key:'2026-01-M'+slot,compliance_year:2026,starts_at:slot===1?'2026-01-20T00:00:00+08:00':'2026-01-01T00:00:00+08:00',deadline_at:'2026-01-31T23:59:59+08:00',grace_period_hours:48,is_open:true})),
  ];
  let saved;
  const client = {
    rpc: async (name,args) => {if(name==='update_recurring_compliance_deadline')saved=args;return {data:0};},
    from(table) {
      let id, payload;
      const result = () => ({ data: payload ? {id} : table === 'compliance_deadline_schedules' ? [{id:'s',frequency:'Weekly'},{id:'m',frequency:'Monthly'}] : id ? periods.find(p => p.id === id) : periods });
      const builder = {
        select() { return builder; }, order() { return builder; },
        eq(column, value) { if (column === 'id') id = value; return builder; },
        update(value) { payload = value; saved = value; return builder; },
        single: async () => result(),
        then(resolve) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  };
  const ctx = vm.createContext({ Intl, Date, document, window: { scrollX: 0, scrollY: 0, scrollTo() {} }, supabaseClient:client, showToast() {} });
  vm.runInContext(shared, ctx);
  const html = fs.readFileSync(path.join(root, 'frontend/deadlines.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1].replace(/\binit\(\);\s*$/, '');
  vm.runInContext(script, ctx);
  await vm.runInContext('load()', ctx);
  const output = document.getElementById('body').innerHTML;
  assert.match(output, /deadline-month/);
  assert.match(output, /October/);
  assert.match(output, /Week 1 — October/);
  assert.doesNotMatch(output, /Future year/);
  const reportPositions=[1,2,3,4].map(slot=>output.indexOf('<strong>January Monthly Report '+slot+'</strong>'));
  assert.ok(reportPositions.every(position=>position>=0));
  assert.deepEqual([...reportPositions].sort((a,b)=>a-b),reportPositions,'monthly reports remain numbered 1–4 even when report 1 starts later');
  await vm.runInContext('openForm("w1")', ctx);
  assert.equal(document.getElementById('deadline-level').value, 'Weekly');
  assert.equal(document.getElementById('deadline-modal').style.display, 'flex');
  document.getElementById('deadline-date').value = '2026-10-07';
  document.getElementById('deadline-time').value = '17:30';
  await vm.runInContext('save()', ctx);
  assert.equal(saved.p_period_id, 'w1');
  assert.equal(saved.p_grace_period_hours, 24);

  assert.equal(saved.p_starts_at, '2026-09-30T16:00:00.000Z');
  assert.equal(saved.p_deadline_at, new Date('2026-10-07T17:30+08:00').toISOString());
  assert.equal(document.getElementById('deadline-modal').style.display, 'none');
  periods[0].is_open = false;
  await vm.runInContext('openForm("w1")', ctx);
  await vm.runInContext('save()', ctx);
  assert.equal(vm.runInContext('editingIsOpen',ctx),false,'closed occurrences remain closed');
  await vm.runInContext('openForm()', ctx);
  assert.equal(vm.runInContext('editingIsOpen', ctx), true, 'a new deadline starts open');
});

test('history follows the report occurrence rather than an early upload',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(shared,ctx);
 vm.runInContext('const realComplianceDate=currentComplianceDate;currentComplianceDate=d=>d?realComplianceDate(d):({year:2026,month:10})',ctx);
 for(const [month,expected] of [['10',false],['11',true]]){
  assert.equal(vm.runInContext(`matchesComplianceAnalyticsPeriod({occurrence_key:'2026-11-W1',compliance_year:2026,deadline_at:'2026-11-07T23:59:59+08:00'},{mode:'monthly',value:'${month}'})`,ctx),expected);
 }
 assert.equal(vm.runInContext(`matchesComplianceAnalyticsPeriod({occurrence_key:'2026-S2',compliance_year:2026,deadline_at:'2026-12-31T23:59:59+08:00'},{mode:'semestral',value:'2'})`,ctx),true);
});
