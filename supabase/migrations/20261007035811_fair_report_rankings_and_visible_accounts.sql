-- Removed accounts disappear from management lists, but retained identities
-- keep historical submission/file attribution and the permanent access block.
do $$
declare definition text;
begin
  select pg_get_functiondef('app_private.list_system_users()'::regprocedure) into definition;
  if position('r on r.user_id=p.id)' in definition)=0 then raise exception 'Unexpected user list'; end if;
  execute replace(definition,'r on r.user_id=p.id)','r on r.user_id=p.id where r.access_removed_at is null)');
  select pg_get_functiondef('app_private.list_secretary_access()'::regprocedure) into definition;
  if position('where p.role=''barangay_secretary''' in definition)=0 then raise exception 'Unexpected access list'; end if;
  execute replace(definition,'where p.role=''barangay_secretary''',
    'where p.role=''barangay_secretary'' and r.access_removed_at is null');
end $$;

-- Editing a deadline must not move a report into a different assigned month.
create function app_private.report_occurrence_at(p public.compliance_periods) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare key text:=p.occurrence_key; day integer:=1;
begin
  if key ~ '^\d{4}-\d{2}-W[1-4]$' then
    day:=(right(key,1)::integer-1)*7+1;
    return (make_date(left(key,4)::integer,substring(key,6,2)::integer,day)+time '12:00') at time zone 'Asia/Manila';
  elsif key ~ '^\d{4}-\d{2}' then
    return (make_date(left(key,4)::integer,substring(key,6,2)::integer,1)+time '12:00') at time zone 'Asia/Manila';
  elsif key ~ '^\d{4}-Q[1-4]$' then
    return (make_date(left(key,4)::integer,(right(key,1)::integer-1)*3+1,1)+time '12:00') at time zone 'Asia/Manila';
  elsif key ~ '^\d{4}-S[12]$' then
    return (make_date(left(key,4)::integer,(right(key,1)::integer-1)*6+1,1)+time '12:00') at time zone 'Asia/Manila';
  end if;
  return p.deadline_at;
end $$;
revoke all on function app_private.report_occurrence_at(public.compliance_periods) from public,anon,authenticated;

-- One common report denominator for all barangays. Each report contributes at
-- most 5 points; drafts/empty files/rejected/returned reports earn zero.
create function app_private.report_rankings(p_start timestamptz,p_end timestamptz,p_year integer,p_report_id uuid)
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
      case when d.required=0 then 0::numeric else round(100*coalesce(s.points,0)/(5*d.required),2) end compliance_rate,
      coalesce(s.compliant,false) is_compliant,coalesce(s.approved_count,0) approved_count,
      case l.timing when 'on_time' then 'Advanced' when 'grace_period' then 'On time'
        when 'late' then 'Late' else coalesce(l.status::text,'Not submitted') end status,
      coalesce(l.last_submitted_at,l.submitted_at) submitted_at
    from public.barangays b cross join (select count(*)::numeric required from periods) d
    left join summary s on s.barangay_id=b.id left join latest l on l.barangay_id=b.id and l.latest_rn=1
    where b.is_active
  )
  select barangay_id,barangay_name,total_points,compliance_rate,
    row_number() over(order by total_points desc,approved_count desc,
      nullif(regexp_replace(barangay_name,'\D','','g'),'')::integer nulls last,barangay_name,barangay_id) current_rank,
    is_compliant,status,submitted_at from rows;
$$;
revoke all on function app_private.report_rankings(timestamptz,timestamptz,integer,uuid) from public,anon,authenticated;

create or replace function app_private.analytics_period_rankings(p_period_type text,p_period_value text)
returns table(barangay_id uuid,barangay_name text,total_points numeric,compliance_rate numeric,current_rank bigint,is_compliant boolean)
language plpgsql stable security definer set search_path='' as $$
declare y integer:=extract(year from now() at time zone 'Asia/Manila');start_date date;end_date date;report uuid;part integer;
begin
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
  return query select r.barangay_id,r.barangay_name,r.total_points,r.compliance_rate,r.current_rank,r.is_compliant
    from app_private.report_rankings(start_date::timestamp at time zone 'Asia/Manila',
      end_date::timestamp at time zone 'Asia/Manila',y,report) r;
end $$;

create or replace function app_private.leaderboard_for_compliance_period(
  p_compliance_period_id uuid default null,p_year integer default null,p_month integer default null)
returns table(barangay_id uuid,barangay_name text,total_points numeric,compliance_rate numeric,current_rank bigint,
  status text,is_compliant boolean,submitted_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.barangay_id,r.barangay_name,r.total_points,r.compliance_rate,r.current_rank,r.status,r.is_compliant,r.submitted_at
  from app_private.report_rankings(
    case when p_month is not null then make_date(coalesce(p_year,extract(year from now() at time zone 'Asia/Manila')::integer),p_month,1)::timestamp at time zone 'Asia/Manila' end,
    case when p_month is not null then (make_date(coalesce(p_year,extract(year from now() at time zone 'Asia/Manila')::integer),p_month,1)+interval '1 month') at time zone 'Asia/Manila' end,
    p_year,p_compliance_period_id) r;
$$;

-- Public output stays restricted to names and ranks, with alphabetic fallback
-- when there are no actual submissions with evidence in the selected month.
create or replace function public.public_barangay_rankings(p_year integer,p_month integer)
returns table(barangay_name text,current_rank bigint)
language sql stable security definer set search_path='' as $$
  with period_bounds as (select make_date(p_year,p_month,1) start_date), activity as (
    select exists(select 1 from public.submissions s join public.compliance_periods cp on cp.id=s.compliance_period_id
      join public.barangays b on b.id=s.barangay_id and b.is_active cross join period_bounds d
      where s.submitted_at is not null and cp.compliance_year=p_year
        and app_private.report_occurrence_at(cp)>=d.start_date::timestamp at time zone 'Asia/Manila'
        and app_private.report_occurrence_at(cp)<(d.start_date+interval '1 month') at time zone 'Asia/Manila'
        and exists(select 1 from public.documents doc join storage.objects o on o.bucket_id='mov-documents' and o.name=doc.storage_path
          where doc.submission_id=s.id and doc.is_current and doc.file_size_bytes>0)) present
  )
  select r.barangay_name,case when a.present then r.current_rank else null::bigint end
    from app_private.leaderboard_for_compliance_period(null,p_year,p_month) r cross join activity a
    where p_year between 2026 and 2100 and p_month between 1 and 12;
$$;
revoke all on function public.public_barangay_rankings(integer,integer) from public;
grant execute on function public.public_barangay_rankings(integer,integer) to anon,authenticated,service_role;
notify pgrst,'reload schema';
