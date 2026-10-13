-- Keep the deployed Advanced/On-time point rules, but honor the exact cutoff.
-- First submitted_at remains the official scoring timestamp; resubmission
-- timestamps and review decisions are not changed by this migration.
create or replace function public.submission_timing_band(
  p_submitted_at timestamptz,
  p_deadline_at timestamptz
) returns public.score_band
language sql immutable security invoker
set search_path = public
as $$
  select case
    when p_submitted_at is null or p_deadline_at is null then 'missing'::public.score_band
    when p_submitted_at > p_deadline_at then 'late'::public.score_band
    when (p_submitted_at at time zone 'Asia/Manila')::date
       < (p_deadline_at at time zone 'Asia/Manila')::date then 'on_time'::public.score_band
    else 'grace_period'::public.score_band
  end;
$$;

-- This helper evaluates supplied timestamps only; it reads no user data.
revoke all on function public.submission_timing_band(timestamptz,timestamptz) from public;
grant execute on function public.submission_timing_band(timestamptz,timestamptz)
  to authenticated, service_role;

create or replace function public.calculate_submission_score(p_submission_id uuid)
returns table(points numeric, band public.score_band)
language plpgsql security definer
set search_path = public
as $$
declare
  v_submission public.submissions%rowtype;
  v_deadline timestamptz;
  v_max_points numeric := 5;
  v_band public.score_band;
begin
  select * into v_submission from public.submissions where id = p_submission_id;
  if not found then raise exception 'Submission % not found', p_submission_id; end if;

  if v_submission.compliance_period_id is not null then
    select deadline_at into v_deadline
      from public.compliance_periods where id = v_submission.compliance_period_id;
  else
    select mp.deadline_at, m.max_points into v_deadline, v_max_points
      from public.mandate_periods mp join public.mandates m on m.id = mp.mandate_id
      where mp.id = v_submission.mandate_period_id;
  end if;

  if v_submission.status = 'rejected' then
    return query select 0::numeric, 'rejected'::public.score_band;
    return;
  end if;

  v_band := public.submission_timing_band(v_submission.submitted_at, v_deadline);
  return query select
    case v_band
      when 'on_time' then v_max_points
      when 'grace_period' then least(3::numeric,v_max_points)
      else 0::numeric
    end,
    v_band;
end;
$$;

-- Only mismatched scoring records change. No files, submissions, review
-- statuses, notes, or submission timestamps are removed or overwritten.
with candidates as materialized (
  select s.id, s.points_awarded as old_points, s.score_band as old_band,
    calculated.points, calculated.band
  from public.submissions s
  cross join lateral public.calculate_submission_score(s.id) calculated
  where s.points_awarded is distinct from calculated.points
     or s.score_band is distinct from calculated.band
), corrected as (
  update public.submissions s
    set points_awarded = c.points, score_band = c.band
  from candidates c where s.id = c.id
  returning s.id, s.points_awarded, s.score_band, c.old_points, c.old_band
)
insert into public.scores (submission_id,points,band,calculation_notes)
select id,points_awarded,score_band,
  format('Exact deadline-time correction: previous points=%s, band=%s',
    old_points,old_band)
from corrected;
