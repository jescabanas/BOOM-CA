-- Separate approval (a compliant barangay) from timeliness (compliance rate).
-- Specific deadline: rank by that deadline's points, then earlier submission.
-- All deadlines in a month/year: rank by the month's compliance rate only.
drop function if exists public.leaderboard_for_compliance_period(uuid, integer, integer);

create or replace function public.leaderboard_for_compliance_period(
  p_compliance_period_id uuid default null, p_year integer default null, p_month integer default null
)
returns table (
  barangay_id uuid, barangay_name text, total_points numeric,
  compliance_rate numeric, current_rank bigint, status text,
  is_compliant boolean, submitted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select s.*
    from submissions s
    left join compliance_periods cp on cp.id = s.compliance_period_id
    where (p_compliance_period_id is null or s.compliance_period_id = p_compliance_period_id)
      and (p_compliance_period_id is not null or p_year is null or cp.compliance_year = p_year)
      and (p_compliance_period_id is not null or p_month is null or extract(month from cp.deadline_at) = p_month)
  ), latest as (
    select *, row_number() over (
      partition by barangay_id
      order by coalesce(last_submitted_at, submitted_at, created_at) desc
    ) as rn
    from scoped
  ), summary as (
    select
      barangay_id,
      count(*) filter (where score_band in ('on_time', 'grace_period'))::numeric as timely_count,
      count(*) filter (where score_band in ('on_time', 'grace_period', 'late'))::numeric as submitted_count
    from scoped
    group by barangay_id
  ), rows as (
    select
      b.id as barangay_id,
      b.name as barangay_name,
      coalesce(l.points_awarded, 0)::numeric as total_points,
      case when coalesce(s.submitted_count, 0) = 0 then 0::numeric
           else round((s.timely_count / s.submitted_count) * 100, 2)
      end as compliance_rate,
      case l.score_band
        when 'on_time' then 'Advanced'
        when 'grace_period' then 'On time'
        when 'late' then 'Late'
        else coalesce(l.status::text, 'Not submitted')
      end as status,
      coalesce(l.status = 'approved', false) as is_compliant,
      coalesce(l.last_submitted_at, l.submitted_at, l.created_at) as submitted_at
    from barangays b
    left join summary s on s.barangay_id = b.id
    left join latest l on l.barangay_id = b.id and l.rn = 1
    where b.is_active
  )
  select
    barangay_id, barangay_name, total_points, compliance_rate,
    case when p_compliance_period_id is not null
      then rank() over (order by total_points desc, submitted_at asc nulls last, barangay_name)
      else rank() over (order by compliance_rate desc, barangay_name)
    end as current_rank,
    status, is_compliant, submitted_at
  from rows;
$$;

grant execute on function public.leaderboard_for_compliance_period(uuid, integer, integer) to authenticated;
