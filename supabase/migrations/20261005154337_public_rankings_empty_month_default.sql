-- Keep public output limited to barangay names and ranks. Null ranks signal an empty month.
create or replace function public.public_barangay_rankings(p_year integer, p_month integer)
returns table(barangay_name text, current_rank bigint)
language sql stable security definer set search_path = '' as $$
  with month_activity as (
    select exists (
      select 1 from public.submissions s
      join public.compliance_periods cp on cp.id = s.compliance_period_id
      join public.barangays b on b.id = s.barangay_id and b.is_active
      where cp.compliance_year = p_year
        and extract(month from cp.deadline_at) = p_month
        and s.score_band in ('on_time', 'grace_period', 'late')
    ) as has_submissions
  )
  select r.barangay_name,
    case when a.has_submissions then r.current_rank else null::bigint end
  from app_private.leaderboard_for_compliance_period(null, p_year, p_month) r
  cross join month_activity a
  where p_year between 2026 and 2100 and p_month between 1 and 12;
$$;
revoke all on function public.public_barangay_rankings(integer,integer) from public;
grant execute on function public.public_barangay_rankings(integer,integer) to anon,authenticated,service_role;
