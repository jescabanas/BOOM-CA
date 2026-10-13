alter table public.compliance_deadline_schedules drop constraint compliance_deadline_schedules_frequency_check;
alter table public.compliance_deadline_schedules add constraint compliance_deadline_schedules_frequency_check
check (frequency in ('Weekly','Monthly','Quarterly','Semestral','Annual'));
insert into public.compliance_deadline_schedules(title,frequency,grace_period_hours)
values('Semestral Report','Semestral',48) on conflict(frequency) do nothing;

create or replace function public.compliance_calendar(p_year integer)
returns table(frequency text, occurrence_key text, period_label text, start_date date, end_date date)
language sql immutable set search_path='' as $$
  with months as (
    select m,make_date(p_year,m,1) first_day,
      (make_date(p_year,m,1)+interval '1 month - 1 day')::date last_day from generate_series(1,12) m
  )
  select 'Weekly',to_char(first_day,'YYYY-MM')||'-W'||w,
    'Week '||w||' — '||trim(to_char(first_day,'Month')), first_day+(w-1)*7,
    case when w=4 then last_day else first_day+w*7-1 end from months cross join generate_series(1,4) w
  union all
  select 'Monthly',to_char(first_day,'YYYY-MM')||'-M'||n,
    'Monthly Report '||n||' — '||trim(to_char(first_day,'Month')),first_day,last_day
    from months cross join generate_series(1,4) n
  union all
  select 'Quarterly',p_year||'-Q'||q,'Quarter '||q,make_date(p_year,(q-1)*3+1,1),
    (make_date(p_year,(q-1)*3+1,1)+interval '3 months - 1 day')::date from generate_series(1,4) q
  union all
  select 'Semestral',p_year||'-S'||s,'Semester '||s,make_date(p_year,(s-1)*6+1,1),
    (make_date(p_year,(s-1)*6+1,1)+interval '6 months - 1 day')::date from generate_series(1,2) s
  union all
  select 'Annual',p_year::text,'Annual',make_date(p_year,1,1),make_date(p_year,12,31);
$$;

create function public.compliance_report_title(p_frequency text,p_key text,p_year integer)
returns text language sql immutable set search_path='' as $$
  select case p_frequency
    when 'Weekly' then trim(to_char(to_date(left(p_key,7)||'-01','YYYY-MM-DD'),'Month'))||' Weekly Report '||right(p_key,1)
    when 'Monthly' then trim(to_char(to_date(left(p_key,7)||'-01','YYYY-MM-DD'),'Month'))||' Monthly Report '||right(p_key,1)
    when 'Quarterly' then 'Quarterly Report '||right(p_key,1)
    when 'Semestral' then 'Semestral Report '||right(p_key,1)
    else 'Annual Report '||p_year end;
$$;
create function public.compliance_report_slot(p_frequency text,p_key text)
returns integer language sql immutable set search_path='' as $$
  select case when p_frequency in ('Weekly','Monthly') then right(p_key,1)::integer else 1 end;
$$;

-- Preserve report and submission IDs while upgrading the old single monthly
-- occurrence into Monthly Report 1. No evidence or submitted records are deleted.
update public.compliance_periods p set occurrence_key=p.occurrence_key||'-M1'
from public.compliance_deadline_schedules ds where ds.id=p.deadline_schedule_id and ds.frequency='Monthly'
  and p.occurrence_key ~ '^\d{4}-\d{2}$';
with normalized as (
 select p.id,c.occurrence_key from public.compliance_periods p join public.compliance_deadline_schedules ds on ds.id=p.deadline_schedule_id
 cross join lateral public.compliance_calendar(p.compliance_year) c
 where ds.frequency=c.frequency and p.period_label=c.period_label and p.occurrence_key is distinct from c.occurrence_key
 and not exists(select 1 from public.compliance_periods other where other.deadline_schedule_id=ds.id and other.occurrence_key=c.occurrence_key)
)
update public.compliance_periods p set occurrence_key=n.occurrence_key from normalized n where p.id=n.id;

-- Adopt manually created monthly reports into the remaining numbered slots.
do $$ declare p record; ds_id uuid; month_key text; slot integer; begin
  select id into ds_id from public.compliance_deadline_schedules where frequency='Monthly';
  for p in select * from public.compliance_periods where deadline_schedule_id is null
    and (period_label ilike '%month%' or title ~* 'monthly\s+report') order by deadline_at,id loop
    month_key:=to_char(p.deadline_at at time zone 'Asia/Manila','YYYY-MM');
    select n into slot from generate_series(1,4) n where not exists(
      select 1 from public.compliance_periods cp where cp.deadline_schedule_id=ds_id and cp.occurrence_key=month_key||'-M'||n
    ) order by n limit 1;
    if slot is not null then
      update public.compliance_periods set deadline_schedule_id=ds_id,occurrence_key=month_key||'-M'||slot,
        period_label='Monthly Report '||slot||' — '||trim(to_char(p.deadline_at at time zone 'Asia/Manila','Month')) where id=p.id;
    end if;
  end loop;
end $$;
with named as (
 select p.id,public.compliance_report_title(ds.frequency,p.occurrence_key,p.compliance_year) title,c.period_label
 from public.compliance_periods p join public.compliance_deadline_schedules ds on ds.id=p.deadline_schedule_id
 cross join lateral public.compliance_calendar(p.compliance_year) c where c.frequency=ds.frequency and c.occurrence_key=p.occurrence_key
)
update public.compliance_periods p set title=n.title,period_label=n.period_label from named n where p.id=n.id;

-- One date pattern for each report number. A pattern is scoped to the selected
-- year and reused when any missing occurrence is regenerated.
create table public.compliance_report_deadline_templates (
  schedule_id uuid not null references public.compliance_deadline_schedules(id),
  compliance_year integer not null,
  report_slot integer not null check(report_slot between 1 and 4),
  start_month_offset integer not null, start_day integer not null check(start_day between 1 and 31), start_time time not null,
  end_month_offset integer not null, end_day integer not null check(end_day between 1 and 31), end_time time not null,
  grace_period_hours integer not null check(grace_period_hours>=0),
  primary key(schedule_id,compliance_year,report_slot)
);
alter table public.compliance_report_deadline_templates enable row level security;
grant select on public.compliance_report_deadline_templates to authenticated;
grant all on public.compliance_report_deadline_templates to service_role;
create policy report_templates_read on public.compliance_report_deadline_templates for select to authenticated
using (auth.uid() is not null);
create policy mfa_required on public.compliance_report_deadline_templates as restrictive for all to authenticated
using ((select app_private.mfa_access_allowed())) with check ((select app_private.mfa_access_allowed()));

create function public.report_pattern_timestamp(p_anchor date,p_month_offset integer,p_day integer,p_time time)
returns timestamptz language sql immutable set search_path='' as $$
  with shifted as (select (p_anchor+make_interval(months=>p_month_offset))::date d)
  select (make_date(extract(year from d)::integer,extract(month from d)::integer,
    least(p_day,extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))::integer))+p_time) at time zone 'Asia/Manila' from shifted;
$$;

create or replace function public.seed_compliance_calendar(p_year integer)
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
  perform pg_advisory_xact_lock(71209,p_year);
  insert into public.compliance_periods(title,compliance_year,period_label,starts_at,deadline_at,grace_period_hours,is_open,created_by,deadline_schedule_id,occurrence_key)
  select public.compliance_report_title(ds.frequency,c.occurrence_key,p_year),p_year,c.period_label,
    case when t.schedule_id is null then c.start_date::timestamp at time zone 'Asia/Manila'
      else public.report_pattern_timestamp(date_trunc('month',c.start_date)::date,t.start_month_offset,t.start_day,t.start_time) end,
    case when t.schedule_id is null then (c.end_date+time '23:59:59') at time zone 'Asia/Manila'
      else public.report_pattern_timestamp(date_trunc('month',c.start_date)::date,t.end_month_offset,t.end_day,t.end_time) end,
    coalesce(t.grace_period_hours,ds.grace_period_hours),true,ds.created_by,ds.id,c.occurrence_key
  from public.compliance_deadline_schedules ds join public.compliance_calendar(p_year) c on c.frequency=ds.frequency
  left join public.compliance_report_deadline_templates t on t.schedule_id=ds.id and t.compliance_year=p_year
    and t.report_slot=public.compliance_report_slot(ds.frequency,c.occurrence_key)
  where ds.is_active and not exists(select 1 from public.compliance_periods old
    where old.deadline_schedule_id=ds.id and old.occurrence_key=c.occurrence_key)
  on conflict do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$$;
revoke all on function public.seed_compliance_calendar(integer) from public,anon,authenticated;

create function public.update_recurring_compliance_deadline(p_period_id uuid,p_starts_at timestamptz,p_deadline_at timestamptz,p_grace_period_hours integer)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.compliance_periods; ds public.compliance_deadline_schedules;
  anchor date; s timestamp; e timestamp; slot integer; affected integer;
begin
  perform app_private.require_mfa();
  if not public.is_staff() then raise exception 'Staff role required' using errcode='42501'; end if;
  select * into p from public.compliance_periods where id=p_period_id;
  select * into ds from public.compliance_deadline_schedules where id=p.deadline_schedule_id for update;
  if ds.id is null then raise exception 'Select an automatically scheduled report'; end if;
  perform pg_advisory_xact_lock(71209,p.compliance_year);
  select date_trunc('month',c.start_date)::date into anchor from public.compliance_calendar(p.compliance_year) c
    where c.frequency=ds.frequency and c.occurrence_key=p.occurrence_key;
  if anchor is null then raise exception 'The report occurrence is unavailable'; end if;
  if p_starts_at is null or p_deadline_at is null or p_starts_at>p_deadline_at or p_grace_period_hours is null or p_grace_period_hours<0 then
    raise exception 'Choose a valid submission window and grace period';
  end if;
  s:=p_starts_at at time zone 'Asia/Manila';e:=p_deadline_at at time zone 'Asia/Manila';
  slot:=public.compliance_report_slot(ds.frequency,p.occurrence_key);
  insert into public.compliance_report_deadline_templates values(ds.id,p.compliance_year,slot,
    (extract(year from s)::integer-extract(year from anchor)::integer)*12+extract(month from s)::integer-extract(month from anchor)::integer,extract(day from s)::integer,s::time,
    (extract(year from e)::integer-extract(year from anchor)::integer)*12+extract(month from e)::integer-extract(month from anchor)::integer,extract(day from e)::integer,e::time,p_grace_period_hours)
  on conflict(schedule_id,compliance_year,report_slot) do update set
    start_month_offset=excluded.start_month_offset,start_day=excluded.start_day,start_time=excluded.start_time,
    end_month_offset=excluded.end_month_offset,end_day=excluded.end_day,end_time=excluded.end_time,grace_period_hours=excluded.grace_period_hours;
  update public.compliance_periods cp set
    starts_at=public.report_pattern_timestamp(date_trunc('month',c.start_date)::date,t.start_month_offset,t.start_day,t.start_time),
    deadline_at=public.report_pattern_timestamp(date_trunc('month',c.start_date)::date,t.end_month_offset,t.end_day,t.end_time),grace_period_hours=t.grace_period_hours
  from public.compliance_calendar(p.compliance_year) c,public.compliance_report_deadline_templates t
  where cp.deadline_schedule_id=ds.id and cp.compliance_year=p.compliance_year and cp.occurrence_key=c.occurrence_key and c.frequency=ds.frequency
    and public.compliance_report_slot(ds.frequency,cp.occurrence_key)=slot and t.schedule_id=ds.id and t.compliance_year=p.compliance_year and t.report_slot=slot;
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.update_recurring_compliance_deadline(uuid,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.update_recurring_compliance_deadline(uuid,timestamptz,timestamptz,integer) to authenticated;

-- Semestral filters use a real six-month range while keeping MFA wrappers.
do $$ declare f record; definition text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname in ('analytics_period_rankings','analytics_period_mandates','analytics_period_barangays_for_mandate') loop
    definition:=pg_get_functiondef(f.oid);
    definition:=replace(definition,'when ''periodical'' then',
      'when ''semestral'' then cp.compliance_year = extract(year from now() at time zone ''Asia/Manila'')::integer and ceil(extract(month from cp.deadline_at at time zone ''Asia/Manila'') / 6.0)::integer = p_period_value::integer when ''periodical'' then');
    execute definition;
  end loop;
end $$;
do $$ declare y integer; begin
  for y in 2026..greatest(2026,extract(year from now() at time zone 'Asia/Manila')::integer) loop perform public.seed_compliance_calendar(y); end loop;
end $$;
