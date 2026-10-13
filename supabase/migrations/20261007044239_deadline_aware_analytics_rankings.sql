-- A missing report is Not submitted only after its exact deadline passes.
-- Each barangay's rate uses due reports plus its valid early submissions;
-- unsubmitted future requirements do not penalize performance. Rank remains
-- total points descending, then approvals and stable barangay name order.
-- Existing caller/MFA gates and file evidence requirements remain enforced.
create or replace function app_private.report_rankings(p_start timestamptz,p_end timestamptz,p_year integer,p_report_id uuid)
returns table(barangay_id uuid,barangay_name text,total_points numeric,compliance_rate numeric,
  current_rank bigint,is_compliant boolean,status text,submitted_at timestamptz)
language sql stable security definer set search_path='' as $$
  with periods as (
    select cp.* from public.compliance_periods cp
    where case when p_report_id is not null then cp.id=p_report_id else
      (p_year is null or cp.compliance_year=p_year)
      and (p_start is null or app_private.report_occurrence_at(cp)>=p_start)
      and (p_end is null or app_private.report_occurrence_at(cp)<p_end) end
  ), available as (
    select s.*,cp.deadline_at,
      row_number() over(partition by s.barangay_id,s.compliance_period_id
        order by coalesce(s.updated_at,s.last_submitted_at,s.submitted_at) desc,s.id) rn
    from public.submissions s join periods cp on cp.id=s.compliance_period_id
    where s.submitted_at is not null and exists(
      select 1 from public.documents d join storage.objects o
        on o.bucket_id='mov-documents' and o.name=d.storage_path
      where d.submission_id=s.id and d.is_current and d.file_size_bytes>0)
  ), scored as (
    select s.*,public.submission_timing_band(s.submitted_at,s.deadline_at) timing,
      case when s.status in ('approved','under_review') then
        case public.submission_timing_band(s.submitted_at,s.deadline_at)
          when 'on_time' then 5 when 'grace_period' then 3 else 0 end
        else 0 end::numeric points
    from available s where rn=1
  ), summary as (
    select s.barangay_id,sum(s.points) points,bool_or(s.status='approved') compliant,
      count(*) filter(where s.status='approved') approved_count
    from scored s group by s.barangay_id
  ), latest as (
    select s.*,row_number() over(partition by s.barangay_id
      order by coalesce(s.updated_at,s.last_submitted_at,s.submitted_at) desc,s.id) latest_rn
    from scored s
  ), rows as (
    select b.id barangay_id,b.name barangay_name,coalesce(s.points,0)::numeric total_points,
      case when d.assessed=0 then 0::numeric else round(100*coalesce(s.points,0)/(5*d.assessed),2) end compliance_rate,
      coalesce(s.compliant,false) is_compliant,coalesce(s.approved_count,0) approved_count,
      case l.timing when 'on_time' then 'Advanced' when 'grace_period' then 'On time'
        when 'late' then 'Late' else coalesce(l.status::text,case when d.assessed=0 then 'Upcoming' else 'Not submitted' end) end status,
      coalesce(l.last_submitted_at,l.submitted_at) submitted_at
    from public.barangays b cross join lateral (
      select count(*)::numeric assessed from periods cp
      left join scored s2 on s2.compliance_period_id=cp.id and s2.barangay_id=b.id
      where cp.deadline_at<now() or s2.id is not null
    ) d
    left join summary s on s.barangay_id=b.id left join latest l on l.barangay_id=b.id and l.latest_rn=1
    where b.is_active
  )
  select barangay_id,barangay_name,total_points,compliance_rate,
    row_number() over(order by total_points desc,approved_count desc,
      nullif(regexp_replace(barangay_name,'\D','','g'),'')::integer nulls last,barangay_name,barangay_id) current_rank,
    is_compliant,status,submitted_at from rows;
$$;

create or replace function app_private.my_barangay_analytics(p_period_type text,p_period_value text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account public.profiles; barangay public.barangays; ranking jsonb; reports jsonb; summary jsonb;
  y integer:=extract(year from now() at time zone 'Asia/Manila');start_date date;end_date date;report uuid;part integer;
begin
  perform app_private.require_mfa();
  select * into account from public.profiles where id=auth.uid() and role='barangay_secretary' and is_active;
  if account.id is null or account.barangay_id is null then
    raise exception 'Active Barangay Secretary required' using errcode='42501';
  end if;
  select * into barangay from public.barangays where id=account.barangay_id and is_active;
  if barangay.id is null then raise exception 'Active barangay required' using errcode='42501';end if;
  case p_period_type
    when 'weekly' then start_date:=p_period_value::date;end_date:=start_date+7;y:=extract(year from start_date);
    when 'monthly' then part:=p_period_value::integer;start_date:=make_date(y,part,1);end_date:=(start_date+interval '1 month')::date;
    when 'quarterly' then part:=p_period_value::integer;if part not between 1 and 4 then raise exception 'Invalid quarter';end if;
      start_date:=make_date(y,(part-1)*3+1,1);end_date:=(start_date+interval '3 months')::date;
    when 'semestral' then part:=p_period_value::integer;if part not between 1 and 2 then raise exception 'Invalid semester';end if;
      start_date:=make_date(y,(part-1)*6+1,1);end_date:=(start_date+interval '6 months')::date;
    when 'annual' then y:=p_period_value::integer;
    when 'periodical' then report:=p_period_value::uuid;
    else raise exception 'Choose a valid analytics period';
  end case;
  select to_jsonb(r) into ranking from app_private.analytics_period_rankings(p_period_type,p_period_value) r
    where r.barangay_id=account.barangay_id;
  with periods as (
    select cp.*,coalesce(ds.frequency::text,case
      when cp.period_label ilike '%week%' then 'Weekly' when cp.period_label ilike '%month%' then 'Monthly'
      when cp.period_label ilike '%quarter%' then 'Quarterly' when cp.period_label ilike '%semestr%' then 'Semestral'
      when cp.period_label ilike '%annual%' then 'Annual' else 'Other' end) frequency
    from public.compliance_periods cp left join public.compliance_deadline_schedules ds on ds.id=cp.deadline_schedule_id
    where case when report is not null then cp.id=report else cp.compliance_year=y
      and (start_date is null or app_private.report_occurrence_at(cp)>=start_date::timestamp at time zone 'Asia/Manila')
      and (end_date is null or app_private.report_occurrence_at(cp)<end_date::timestamp at time zone 'Asia/Manila') end
  ), available as (
    select s.*,row_number() over(partition by s.compliance_period_id
      order by coalesce(s.updated_at,s.last_submitted_at,s.submitted_at) desc,s.id) rn
    from public.submissions s join periods cp on cp.id=s.compliance_period_id
    where s.barangay_id=account.barangay_id and s.submitted_at is not null
      and exists(select 1 from public.documents d join storage.objects o on o.bucket_id='mov-documents' and o.name=d.storage_path
        where d.submission_id=s.id and d.is_current and d.file_size_bytes>0)
  ), rows as (
    select cp.*,s.id submission_id,s.status review_status,s.submitted_at,s.last_submitted_at,
      public.submission_timing_band(s.submitted_at,cp.deadline_at) timing
    from periods cp left join available s on s.compliance_period_id=cp.id and s.rn=1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'period_label',r.period_label,
    'frequency',r.frequency,'deadline_at',r.deadline_at,'starts_at',r.starts_at,'is_open',r.is_open,
    'submission_id',r.submission_id,'status',coalesce(r.review_status::text,case when r.deadline_at<now() then 'not_submitted' else 'upcoming' end),
    'timing',case when r.submission_id is null and r.deadline_at>=now() then 'upcoming' else r.timing::text end,'submitted_at',r.submitted_at,'last_submitted_at',r.last_submitted_at,
    'overdue',r.submission_id is null and r.deadline_at<now(),
    'points',case when r.review_status in ('approved','under_review') then case r.timing
      when 'on_time' then 5 when 'grace_period' then 3 else 0 end else 0 end)
    order by r.deadline_at,r.title,r.id),'[]'::jsonb),
    jsonb_build_object('required_reports',count(*),'submitted_reports',count(r.submission_id),
      'not_submitted_reports',count(*) filter(where r.submission_id is null and r.deadline_at<now()),
      'overdue_reports',count(*) filter(where r.submission_id is null and r.deadline_at<now()),
      'upcoming_reports',count(*) filter(where r.submission_id is null and r.deadline_at>=now()),
      'advanced_reports',count(*) filter(where r.submission_id is not null and r.timing='on_time'),
      'on_time_reports',count(*) filter(where r.submission_id is not null and r.timing='grace_period'),
      'late_reports',count(*) filter(where r.submission_id is not null and r.timing='late'),
      'approved_reports',count(*) filter(where r.review_status='approved'),
      'pending_reports',count(*) filter(where r.review_status='under_review'),
      'rejected_reports',count(*) filter(where r.review_status='rejected'),
      'returned_reports',count(*) filter(where r.review_status='correction_requested'),
      'assessed_reports',count(*) filter(where r.deadline_at<now() or r.submission_id is not null),'possible_points',5*count(*) filter(where r.deadline_at<now() or r.submission_id is not null),'total_points',coalesce((ranking->>'total_points')::numeric,0),
      'compliance_rate',coalesce((ranking->>'compliance_rate')::numeric,0),
      'rank',case when count(*)>0 then (ranking->>'current_rank')::bigint else null end,
      'ranked_barangays',(select count(*) from public.barangays where is_active))
    into reports,summary from rows r;
  return jsonb_build_object('barangay',jsonb_build_object('id',barangay.id,'name',barangay.name),
    'summary',summary,'reports',reports);
end $$;

notify pgrst,'reload schema';
