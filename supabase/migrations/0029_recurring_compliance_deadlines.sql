-- Standing compliance schedules create the actual weekly/monthly/quarterly/
-- annual submission periods that secretaries see. Individual generated
-- periods remain editable without changing the rest of the schedule.

create table if not exists public.compliance_deadline_schedules (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  frequency text not null check (frequency in ('Weekly', 'Monthly', 'Quarterly', 'Annual')),
  due_weekday smallint check (due_weekday between 0 and 6),
  due_day smallint not null default 15 check (due_day between 1 and 31),
  due_month_in_quarter smallint check (due_month_in_quarter between 1 and 3),
  due_month smallint check (due_month between 1 and 12),
  due_time time not null default time '17:00',
  grace_period_hours integer not null default 48 check (grace_period_hours >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (frequency)
);

create trigger trg_compliance_deadline_schedules_updated
before update on public.compliance_deadline_schedules
for each row execute function public.set_updated_at();

alter table public.compliance_periods
  add column if not exists deadline_schedule_id uuid references public.compliance_deadline_schedules(id) on delete set null,
  add column if not exists occurrence_key text;

create unique index if not exists compliance_periods_schedule_occurrence_key
  on public.compliance_periods(deadline_schedule_id, occurrence_key)
  where deadline_schedule_id is not null;

alter table public.compliance_deadline_schedules enable row level security;

create policy compliance_deadline_schedules_read_authenticated
  on public.compliance_deadline_schedules for select
  using (auth.uid() is not null);

create policy compliance_deadline_schedules_staff_manage
  on public.compliance_deadline_schedules for all
  using (public.is_staff()) with check (public.is_staff());

-- Sensible initial templates. Staff can edit each generated deadline, or
-- change a schedule later, without exposing any future period to secretaries
-- until its `is_open` value is true.
insert into public.compliance_deadline_schedules
  (title, frequency, due_weekday, due_day, due_month_in_quarter, due_month, due_time, grace_period_hours)
values
  ('Weekly Compliance', 'Weekly', 1, 1, null, null, time '17:00', 24),
  ('Monthly Compliance', 'Monthly', null, 15, null, null, time '17:00', 48),
  ('Quarterly Compliance', 'Quarterly', null, 15, 3, null, time '17:00', 48),
  ('Annual Compliance', 'Annual', null, 15, null, 12, time '17:00', 48)
on conflict (frequency) do nothing;

create or replace function public.ensure_compliance_schedule_periods()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  schedule_row public.compliance_deadline_schedules%rowtype;
  deadline_date date;
  deadline_value timestamptz;
  occurrence text;
  label text;
  year_value integer;
  month_value integer;
  day_value integer;
  offset_value integer;
  inserted_count integer := 0;
  row_count integer := 0;
  first_weekly_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  for schedule_row in
    select * from public.compliance_deadline_schedules
    where is_active
    order by case frequency when 'Weekly' then 1 when 'Monthly' then 2 when 'Quarterly' then 3 else 4 end
  loop
    if schedule_row.frequency = 'Weekly' then
      first_weekly_date := current_date + ((schedule_row.due_weekday - extract(dow from current_date)::integer + 7) % 7);
      for offset_value in 0..52 loop
        deadline_date := first_weekly_date + (offset_value * 7);
        occurrence := to_char(deadline_date, 'YYYY-MM-DD');
        label := format('Week %s — %s', ceil(extract(day from deadline_date) / 7.0)::integer, trim(to_char(deadline_date, 'Month')));
        deadline_value := make_timestamptz(extract(year from deadline_date)::integer, extract(month from deadline_date)::integer, extract(day from deadline_date)::integer, extract(hour from schedule_row.due_time)::integer, extract(minute from schedule_row.due_time)::integer, 0, 'Asia/Manila');
        insert into public.compliance_periods (title, compliance_year, period_label, deadline_at, grace_period_hours, is_open, created_by, deadline_schedule_id, occurrence_key)
        values (schedule_row.title, extract(year from deadline_date)::integer, label, deadline_value, schedule_row.grace_period_hours, true, schedule_row.created_by, schedule_row.id, occurrence)
        on conflict do nothing;
        get diagnostics row_count = row_count;
        inserted_count := inserted_count + row_count;
      end loop;
    elsif schedule_row.frequency = 'Monthly' then
      for offset_value in 0..12 loop
        deadline_date := (date_trunc('month', current_date) + make_interval(months => offset_value))::date;
        year_value := extract(year from deadline_date)::integer;
        month_value := extract(month from deadline_date)::integer;
        day_value := least(schedule_row.due_day, extract(day from (date_trunc('month', deadline_date) + interval '1 month - 1 day'))::integer);
        deadline_date := make_date(year_value, month_value, day_value);
        occurrence := to_char(deadline_date, 'YYYY-MM');
        label := trim(to_char(deadline_date, 'Month'));
        deadline_value := make_timestamptz(year_value, month_value, day_value, extract(hour from schedule_row.due_time)::integer, extract(minute from schedule_row.due_time)::integer, 0, 'Asia/Manila');
        insert into public.compliance_periods (title, compliance_year, period_label, deadline_at, grace_period_hours, is_open, created_by, deadline_schedule_id, occurrence_key)
        values (schedule_row.title, year_value, label, deadline_value, schedule_row.grace_period_hours, true, schedule_row.created_by, schedule_row.id, occurrence)
        on conflict do nothing;
        get diagnostics row_count = row_count;
        inserted_count := inserted_count + row_count;
      end loop;
    elsif schedule_row.frequency = 'Quarterly' then
      for offset_value in 0..4 loop
        deadline_date := (date_trunc('quarter', current_date) + make_interval(months => offset_value * 3 + schedule_row.due_month_in_quarter - 1))::date;
        year_value := extract(year from deadline_date)::integer;
        month_value := extract(month from deadline_date)::integer;
        day_value := least(schedule_row.due_day, extract(day from (date_trunc('month', deadline_date) + interval '1 month - 1 day'))::integer);
        deadline_date := make_date(year_value, month_value, day_value);
        occurrence := to_char(deadline_date, 'YYYY') || '-Q' || extract(quarter from deadline_date)::integer;
        label := 'Quarter ' || extract(quarter from deadline_date)::integer;
        deadline_value := make_timestamptz(year_value, month_value, day_value, extract(hour from schedule_row.due_time)::integer, extract(minute from schedule_row.due_time)::integer, 0, 'Asia/Manila');
        insert into public.compliance_periods (title, compliance_year, period_label, deadline_at, grace_period_hours, is_open, created_by, deadline_schedule_id, occurrence_key)
        values (schedule_row.title, year_value, label, deadline_value, schedule_row.grace_period_hours, true, schedule_row.created_by, schedule_row.id, occurrence)
        on conflict do nothing;
        get diagnostics row_count = row_count;
        inserted_count := inserted_count + row_count;
      end loop;
    else
      for offset_value in 0..1 loop
        year_value := extract(year from current_date)::integer + offset_value;
        day_value := least(schedule_row.due_day, extract(day from (make_date(year_value, schedule_row.due_month, 1) + interval '1 month - 1 day'))::integer);
        deadline_date := make_date(year_value, schedule_row.due_month, day_value);
        occurrence := to_char(deadline_date, 'YYYY');
        deadline_value := make_timestamptz(year_value, schedule_row.due_month, day_value, extract(hour from schedule_row.due_time)::integer, extract(minute from schedule_row.due_time)::integer, 0, 'Asia/Manila');
        insert into public.compliance_periods (title, compliance_year, period_label, deadline_at, grace_period_hours, is_open, created_by, deadline_schedule_id, occurrence_key)
        values (schedule_row.title, year_value, 'Annual', deadline_value, schedule_row.grace_period_hours, true, schedule_row.created_by, schedule_row.id, occurrence)
        on conflict do nothing;
        get diagnostics row_count = row_count;
        inserted_count := inserted_count + row_count;
      end loop;
    end if;
  end loop;
  return inserted_count;
end;
$$;

grant execute on function public.ensure_compliance_schedule_periods() to authenticated;
