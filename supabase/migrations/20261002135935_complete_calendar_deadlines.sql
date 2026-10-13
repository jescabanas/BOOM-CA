-- Requires 0029. Existing submissions and edited periods retain their IDs.
begin;
alter table public.compliance_periods add column if not exists starts_at timestamptz;

-- Recoverable backup of only the unused records retired by this migration.
create table if not exists public.compliance_deadline_cleanup_backup (
  id uuid primary key,
  period_data jsonb not null,
  reason text not null,
  archived_at timestamptz not null default now()
);
alter table public.compliance_deadline_cleanup_backup enable row level security;
revoke all on public.compliance_deadline_cleanup_backup from anon, authenticated;

lock table public.compliance_periods in share row exclusive mode;
insert into public.compliance_deadline_cleanup_backup (id, period_data, reason)
select p.id, to_jsonb(p), case when p.deadline_schedule_id is not null
  then 'Unused, unedited rolling schedule replaced by full calendar'
  else 'Expired custom deadline with unrecognized period label' end
from public.compliance_periods p
where not exists (select 1 from public.submissions s where s.compliance_period_id = p.id)
and (
  (p.deadline_schedule_id is not null and p.updated_at = p.created_at)
  or (p.deadline_schedule_id is null and p.deadline_at < now()
    and lower(trim(p.period_label)) !~ '(week|month|quarter|annual|year|period|january|february|march|april|may|june|july|august|september|october|november|december)')
)
on conflict (id) do nothing;

delete from public.compliance_periods p
using public.compliance_deadline_cleanup_backup b
where p.id = b.id
  and not exists (select 1 from public.submissions s where s.compliance_period_id = p.id);

-- Pure calendar: four month-relative weeks; week 4 includes all remaining days.
create or replace function public.compliance_calendar(p_year integer)
returns table(frequency text, occurrence_key text, period_label text, start_date date, end_date date)
language sql immutable set search_path = public as $$
  with months as (
    select m, make_date(p_year, m, 1) first_day,
      (make_date(p_year, m, 1) + interval '1 month - 1 day')::date last_day
    from generate_series(1,12) m
  )
  select 'Weekly', to_char(first_day, 'YYYY-MM') || '-W' || w,
    'Week ' || w || ' — ' || trim(to_char(first_day, 'Month')),
    first_day + (w-1)*7,
    case when w = 4 then last_day else first_day + w*7-1 end
  from months cross join generate_series(1,4) w
  union all
  select 'Monthly', to_char(first_day,'YYYY-MM'), trim(to_char(first_day,'Month')), first_day, last_day from months
  union all
  select 'Quarterly', p_year || '-Q' || q, 'Quarter ' || q,
    make_date(p_year,(q-1)*3+1,1),
    (make_date(p_year,(q-1)*3+1,1) + interval '3 months - 1 day')::date
  from generate_series(1,4) q
  union all
  select 'Annual', p_year::text, 'Annual', make_date(p_year,1,1), make_date(p_year,12,31);
$$;

-- Backfill starts for preserved rows without moving their end deadlines.
update public.compliance_periods p
set starts_at = least(p.deadline_at,
  coalesce(
    (select c.start_date::timestamp at time zone 'Asia/Manila'
     from public.compliance_deadline_schedules ds
     cross join lateral public.compliance_calendar(p.compliance_year) c
     where ds.id = p.deadline_schedule_id and c.frequency = ds.frequency
       and (c.occurrence_key = p.occurrence_key or c.period_label = p.period_label)
     limit 1),
    date_trunc('day',p.deadline_at at time zone 'Asia/Manila') at time zone 'Asia/Manila'))
where p.starts_at is null;

alter table public.compliance_periods alter column starts_at set not null;
alter table public.compliance_periods add constraint compliance_period_dates_ordered
  check (starts_at <= deadline_at);

-- Private implementation; only the authenticated wrapper below can generate.
create or replace function public.seed_compliance_calendar(p_year integer)
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  perform pg_advisory_xact_lock(71209, p_year);
  insert into public.compliance_periods
    (title, compliance_year, period_label, starts_at, deadline_at,
     grace_period_hours, is_open, created_by, deadline_schedule_id, occurrence_key)
  select ds.title, p_year, c.period_label,
    c.start_date::timestamp at time zone 'Asia/Manila',
    (c.end_date + time '23:59:59') at time zone 'Asia/Manila',
    ds.grace_period_hours, true, ds.created_by, ds.id, c.occurrence_key
  from public.compliance_deadline_schedules ds
  join public.compliance_calendar(p_year) c on c.frequency = ds.frequency
  where ds.is_active
    and not exists (
      select 1 from public.compliance_periods old
      where old.deadline_schedule_id = ds.id and old.compliance_year = p_year
        and (old.occurrence_key = c.occurrence_key or old.period_label = c.period_label))
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke all on function public.seed_compliance_calendar(integer) from public, anon, authenticated;

drop function public.ensure_compliance_schedule_periods();
create function public.ensure_compliance_schedule_periods(p_year integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  current_year integer := extract(year from now() at time zone 'Asia/Manila')::integer;
  requested_year integer := coalesce(p_year, current_year);
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and is_active
      and role in ('super_admin','huc_director','barangay_secretary')
  ) then raise exception 'Active staff or secretary account required'; end if;
  if requested_year < 2026 or requested_year > current_year then
    raise exception 'Select a year from 2026 through the current year';
  end if;
  return public.seed_compliance_calendar(requested_year);
end;
$$;
revoke all on function public.ensure_compliance_schedule_periods(integer) from public, anon;
grant execute on function public.ensure_compliance_schedule_periods(integer) to authenticated;

-- Fill every year already available in the year picker immediately.
do $$
declare y integer;
begin
  for y in 2026..greatest(2026,extract(year from now() at time zone 'Asia/Manila')::integer) loop
    perform public.seed_compliance_calendar(y);
  end loop;
end;
$$;
commit;
