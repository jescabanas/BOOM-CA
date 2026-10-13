-- The caller cannot select another barangay: identity and assignment come
-- from the current active profile after verified MFA, not from request data.
create function app_private.my_barangay_analytics(p_period_type text,p_period_value text) returns jsonb
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
    'submission_id',r.submission_id,'status',coalesce(r.review_status::text,'not_submitted'),
    'timing',r.timing,'submitted_at',r.submitted_at,'last_submitted_at',r.last_submitted_at,
    'overdue',r.submission_id is null and r.deadline_at<now(),
    'points',case when r.review_status in ('approved','under_review') then case r.timing
      when 'on_time' then 5 when 'grace_period' then 3 else 0 end else 0 end)
    order by r.deadline_at,r.title,r.id),'[]'::jsonb),
    jsonb_build_object('required_reports',count(*),'submitted_reports',count(r.submission_id),
      'not_submitted_reports',count(*) filter(where r.submission_id is null),
      'overdue_reports',count(*) filter(where r.submission_id is null and r.deadline_at<now()),
      'upcoming_reports',count(*) filter(where r.submission_id is null and r.deadline_at>=now()),
      'advanced_reports',count(*) filter(where r.submission_id is not null and r.timing='on_time'),
      'on_time_reports',count(*) filter(where r.submission_id is not null and r.timing='grace_period'),
      'late_reports',count(*) filter(where r.submission_id is not null and r.timing='late'),
      'approved_reports',count(*) filter(where r.review_status='approved'),
      'pending_reports',count(*) filter(where r.review_status='under_review'),
      'rejected_reports',count(*) filter(where r.review_status='rejected'),
      'returned_reports',count(*) filter(where r.review_status='correction_requested'),
      'possible_points',count(*)*5,'total_points',coalesce((ranking->>'total_points')::numeric,0),
      'compliance_rate',coalesce((ranking->>'compliance_rate')::numeric,0),
      'rank',case when count(*)>0 then (ranking->>'current_rank')::bigint else null end,
      'ranked_barangays',(select count(*) from public.barangays where is_active))
    into reports,summary from rows r;
  return jsonb_build_object('barangay',jsonb_build_object('id',barangay.id,'name',barangay.name),
    'summary',summary,'reports',reports);
end $$;
revoke all on function app_private.my_barangay_analytics(text,text) from public,anon;
grant execute on function app_private.my_barangay_analytics(text,text) to authenticated;
create function public.my_barangay_analytics(p_period_type text,p_period_value text) returns jsonb
language sql stable security invoker set search_path='' as $$ select app_private.my_barangay_analytics(p_period_type,p_period_value) $$;
revoke all on function public.my_barangay_analytics(text,text) from public,anon;
grant execute on function public.my_barangay_analytics(text,text) to authenticated;
notify pgrst,'reload schema';
