const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({Intl,Date});
vm.runInContext(fs.readFileSync(path.join(root,'frontend/js/period-filter.js'),'utf8'),context);
vm.runInContext('const realComplianceDate=currentComplianceDate;currentComplianceDate=d=>d?realComplianceDate(d):({year:2026,month:10,day:8})',context);
const evaluate=source=>JSON.parse(vm.runInContext(`JSON.stringify(${source})`,context));

test('every month has four report weeks covering only its assigned dates',()=>{
  for(const year of [2026,2028])for(let month=1;month<=12;month++){
    const key=`${year}-${String(month).padStart(2,'0')}`;
    const weeks=evaluate(`complianceWeeksForMonth('${key}')`);
    assert.equal(weeks.length,4);
    assert.deepEqual(weeks.map(w=>w.value),[1,8,15,22].map(d=>key+'-'+String(d).padStart(2,'0')));
    for(let i=0;i<3;i++)assert.equal(weeks[i].end,weeks[i+1].value);
    assert.equal(weeks[3].end,new Date(Date.UTC(year,month,1)).toISOString().slice(0,10));
    assert.equal(weeks[3].label,`Week 4 (${weeks[0].label.match(/\((\w+)/)[1]} 22 – ${weeks[0].label.match(/\((\w+)/)[1]} ${new Date(Date.UTC(year,month,0)).getUTCDate()})`);
  }
});

test('old Week 5 links resolve to Week 4 and Philippine month boundaries exclude November',()=>{
  assert.deepEqual(evaluate("analyticsPeriodArgs({mode:'weekly',value:'2026-10-26'})"),{p_period_type:'weekly',p_period_value:'2026-10-22'});
  assert.equal(evaluate("matchesAnalyticsPeriod('2026-10-31T23:59:59+08:00',{mode:'weekly',value:'2026-10-22'})"),true);
  assert.equal(evaluate("matchesAnalyticsPeriod('2026-11-01T00:00:00+08:00',{mode:'weekly',value:'2026-10-22'})"),false);
  for(const value of ['2026-10-22','2026-10-26']){
    assert.equal(evaluate(`matchesComplianceAnalyticsPeriod({occurrence_key:'2026-11-W1',compliance_year:2026,deadline_at:'2026-10-31T23:59:59+08:00'},{mode:'weekly',value:'${value}'})`),false);
    assert.equal(evaluate(`matchesComplianceAnalyticsPeriod({occurrence_key:'2026-10-W4',compliance_year:2026,deadline_at:'2026-11-05T23:59:59+08:00'},{mode:'weekly',value:'${value}'})`),true);
  }
});

test('additional choices require saved administrator deadlines, for every compliance type',()=>{
  const fixtures=[];
  for(const [mode,frequency,key] of [['weekly','Weekly','2026-10-W1'],['monthly','Monthly','2026-10-M1'],['quarterly','Quarterly','2026-Q1'],['semestral','Semestral','2026-S1'],['annual','Annual','2026']]){
    const base={frequency,compliance_year:2026,deadline_at:'2026-10-31T23:59:59+08:00',period_label:frequency};
    fixtures.push({...base,id:mode+'-standard',occurrence_key:key});
    fixtures.push({...base,id:mode+'-extra',title:'Administrator saved '+frequency,occurrence_key:null});
    fixtures.push({...base,id:mode+'-next-year',compliance_year:2027,occurrence_key:null});
  }
  fixtures.push({id:'november-extra',title:'Additional weekly November',period_label:'Weekly',compliance_year:2026,occurrence_key:null,deadline_at:'2026-11-05T23:59:59+08:00'});
  fixtures.push({id:'numbered-extra',title:'October Weekly Report 5',period_label:'Week 5 — October',compliance_year:2026,occurrence_key:'2026-10-W5',deadline_at:'2026-11-05T23:59:59+08:00'});
  for(const mode of ['weekly','monthly','quarterly','semestral','annual']){
    assert.deepEqual(evaluate(`additionalCompliancePeriods([], '${mode}').map(p=>p.id)`),[]);
    const actual=evaluate(`additionalCompliancePeriods(${JSON.stringify(fixtures)}, '${mode}', ${mode==='weekly'?"'2026-10'":"''"}).map(p=>p.id)`);
    assert.deepEqual(actual,mode==='weekly'?['weekly-extra','numbered-extra']:[mode+'-extra']);
  }
});

test('database analytics keeps early November submissions in November, including legacy week links',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon;create role authenticated;create schema app_private;create schema auth;create schema storage;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      create function app_private.require_mfa() returns void language sql as $$select$$;
      create table profiles(id uuid,role text,is_active boolean,barangay_id uuid);
      create table barangays(id uuid,name text,is_active boolean);
      create table compliance_deadline_schedules(id uuid,frequency text);
      create table compliance_periods(id uuid,title text,period_label text,compliance_year integer,
        occurrence_key text,deadline_at timestamptz,starts_at timestamptz,is_open boolean,deadline_schedule_id uuid);
      create table submissions(id uuid,barangay_id uuid,compliance_period_id uuid,status text,
        submitted_at timestamptz,last_submitted_at timestamptz,updated_at timestamptz);
      create table documents(submission_id uuid,storage_path text,is_current boolean,file_size_bytes integer);
      create table storage.objects(bucket_id text,name text);
      create function submission_timing_band(t timestamptz,d timestamptz) returns text language sql as $$
        select case when t is null then 'missing' when t<d then 'on_time' when t=d then 'grace_period' else 'late' end$$;
      insert into barangays values('22222222-2222-4222-8222-222222222222','Test Barangay',true);
      insert into profiles values(auth.uid(),'barangay_secretary',true,'22222222-2222-4222-8222-222222222222');
    `);
    const fair=fs.readFileSync(path.join(root,'supabase/migrations/20261007035811_fair_report_rankings_and_visible_accounts.sql'),'utf8');
    await db.exec(fair.slice(fair.indexOf('create function app_private.report_occurrence_at'),fair.indexOf('create or replace function app_private.leaderboard_for_compliance_period')));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261007044239_deadline_aware_analytics_rankings.sql'),'utf8'));
    await db.exec(`
      insert into compliance_periods values
        ('33333333-3333-4333-8333-333333333333','October Weekly Report 4','Week 4 — October',2026,'2026-10-W4','2026-11-05 23:59:59+08','2026-10-22 00:00+08',true,null),
        ('44444444-4444-4444-8444-444444444444','November Weekly Report 1','Week 1 — November',2026,'2026-11-W1','2026-11-05 23:59:59+08','2026-11-01 00:00+08',true,null),
        ('55555555-5555-4555-8555-555555555555','November Monthly Report 1','Monthly Report 1 — November',2026,'2026-11-M1','2026-11-20 23:59:59+08','2026-11-01 00:00+08',true,null);
      insert into submissions values('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444','approved','2026-10-06 11:10+08',null,null);
      insert into documents values('66666666-6666-4666-8666-666666666666','early.pdf',true,20);
      insert into storage.objects values('mov-documents','early.pdf');
    `);
    const snapshot=async(type,value)=>(await db.query('select app_private.my_barangay_analytics($1,$2) result',[type,value])).rows[0].result;
    const before=await snapshot('weekly','2026-10-26');
    assert.equal(before.reports.filter(r=>r.title.startsWith('November')).length,2,'reproduce October calendar week leaking November');
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261008143509_assigned_report_weeks_analytics.sql'),'utf8'));
    for(const value of ['2026-10-22','2026-10-26']){
      const data=await snapshot('weekly',value);
      assert.deepEqual(data.reports.map(r=>r.title),['October Weekly Report 4']);
      assert.equal(data.summary.submitted_reports,0);
      assert.equal(data.summary.total_points,0);
      const ranks=await db.query('select total_points from app_private.analytics_period_rankings($1,$2)',['weekly',value]);
      assert.equal(Number(ranks.rows[0].total_points),0);
    }
    const october=await snapshot('monthly','10'),november=await snapshot('monthly','11');
    assert.equal(october.summary.submitted_reports,0);
    assert.equal(november.summary.submitted_reports,1);
    assert.equal(november.summary.total_points,5);
    const early=november.reports.find(r=>r.submission_id);
    assert.equal(early.title,'November Weekly Report 1');
    assert.equal(new Date(early.submitted_at).toISOString(),'2026-10-06T03:10:00.000Z');
    // Selecting a saved addition uses the existing exact-report RPC, independent
    // of the generated week count or the timestamp of an early upload.
    await db.exec(`insert into compliance_periods values
      ('77777777-7777-4777-8777-777777777777','Admin-created weekly addition','Weekly',2026,null,
       '2026-11-05 23:59:59+08','2026-11-01 00:00+08',true,null)`);
    const additional=await snapshot('periodical','77777777-7777-4777-8777-777777777777');
    assert.deepEqual(additional.reports.map(r=>r.title),['Admin-created weekly addition']);
    assert.equal(additional.summary.required_reports,1);
    assert.equal((await snapshot('monthly','10')).reports.some(r=>r.title==='Admin-created weekly addition'),false);
    for(const [value,end] of [['2026-02-22','2026-03-01'],['2028-02-22','2028-03-01'],['2026-12-31','2027-01-01']]){
      assert.equal((await db.query('select end_date::text from app_private.report_week_bounds($1)',[value])).rows[0].end_date,end);
    }
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select * from app_private.report_week_bounds('2026-10-22')"),/permission denied/);
  }finally{await db.close();}
});
