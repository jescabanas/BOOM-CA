// Run with PGLITE_MODULE pointing to a temporary @electric-sql/pglite installation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');

test('complete calendar migration, recoverable cleanup and regeneration', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('test.user_id',true),'')::uuid;
      $$;
      set test.user_id = '11111111-1111-1111-1111-111111111111';
      create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid(); $$;
      create function public.set_updated_at() returns trigger language plpgsql as $$
        begin new.updated_at := now(); return new; end;
      $$;
      create function public.is_staff() returns boolean language sql as $$ select true; $$;
      create table public.profiles(id uuid primary key, is_active boolean, role text);
      insert into profiles values ('11111111-1111-1111-1111-111111111111',true,'super_admin');
      create table public.compliance_periods (
        id uuid primary key default gen_random_uuid(), title text not null,
        compliance_year integer not null, period_label text not null,
        deadline_at timestamptz not null, grace_period_hours integer default 48,
        is_open boolean default true, created_by uuid references profiles(id),
        created_at timestamptz default now(), updated_at timestamptz default now(),
        unique(title,compliance_year,period_label)
      );
      create table public.submissions(id uuid primary key default gen_random_uuid(),
        compliance_period_id uuid references compliance_periods(id) on delete cascade);
    `);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/0029_recurring_compliance_deadlines.sql'),'utf8'));
    await db.exec(`
      insert into compliance_periods(title,compliance_year,period_label,deadline_at)
      values ('unused invalid',2026,'forever','2020-01-01'),('submitted invalid',2026,'forever','2020-01-01');
      insert into submissions(compliance_period_id) select id from compliance_periods where title='submitted invalid';
      insert into compliance_periods(title,compliance_year,period_label,deadline_at,deadline_schedule_id,occurrence_key)
      select title,2026,'Week 1 — October','2026-10-05 17:00+08',id,'2026-10-05'
      from compliance_deadline_schedules where frequency='Weekly';
      insert into compliance_periods(title,compliance_year,period_label,deadline_at,deadline_schedule_id,occurrence_key,updated_at)
      select 'Edited weekly title',2026,'Week 2 — October','2026-10-16 17:00+08',id,'2026-10-12',now()+interval '1 second'
      from compliance_deadline_schedules where frequency='Weekly';
    `);
    const oldEdited = (await db.query("select id,deadline_at from compliance_periods where title='Edited weekly title'")).rows[0];
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261002135935_complete_calendar_deadlines.sql'),'utf8'));
    const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
    assert.equal(await scalar("select count(*)::int from compliance_periods where title='unused invalid'"),0);
    assert.equal(await scalar("select count(*)::int from compliance_deadline_cleanup_backup"),2);
    assert.equal(await scalar("select count(*)::int from submissions"),1);
    assert.equal(await scalar("select count(*)::int from compliance_periods where title='submitted invalid'"),1);
    const edited = (await db.query("select id,deadline_at from compliance_periods where title='Edited weekly title'")).rows[0];
    assert.deepEqual(edited,oldEdited);
    assert.equal(await scalar("select count(*)::int from compliance_periods where deadline_schedule_id is not null and compliance_year=2026"),65);
    assert.equal(await scalar("select ensure_compliance_schedule_periods(2026)"),0);
    assert.equal(await scalar("select ensure_compliance_schedule_periods(2026)"),0);
    assert.equal(await scalar("select count(*)::int from compliance_calendar(2026) where frequency='Weekly'"),48);
    assert.equal(await scalar("select end_date::text from compliance_calendar(2028) where occurrence_key='2028-02-W4'"),'2028-02-29');
    assert.equal(await scalar("select end_date::text from compliance_calendar(2026) where occurrence_key='2026-02-W4'"),'2026-02-28');
    assert.equal(await scalar("select start_date::text from compliance_calendar(2026) where occurrence_key='2026-10-W1'"),'2026-10-01');
    assert.equal(await scalar("select end_date::text from compliance_calendar(2026) where occurrence_key='2026-10-W4'"),'2026-10-31');
    assert.equal(await scalar("select seed_compliance_calendar(2028)"),65);
    assert.equal(await scalar("select seed_compliance_calendar(2028)"),0);
    assert.equal(await scalar("select count(*)::int from compliance_periods where starts_at > deadline_at"),0);
    await assert.rejects(db.exec("update compliance_periods set starts_at=deadline_at+interval '1 day' where title='Edited weekly title'"));
    await db.exec("set test.user_id=''");
    await assert.rejects(db.query("select ensure_compliance_schedule_periods(2026)"),/Active staff/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select seed_compliance_calendar(2026)"),/permission denied/);
    console.log('Verified 65 periods/year, leap years, idempotence, date validation, authorization and recoverable cleanup.');
  } finally { await db.close(); }
});
