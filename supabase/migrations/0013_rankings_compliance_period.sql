-- One scoring result per barangay for the selected compliance deadline.
-- Points are deliberately the single submission band score (5 / 3 / 0),
-- rather than an all-time accumulated total.
create or replace function public.leaderboard_for_compliance_period(
  p_compliance_period_id uuid default null, p_year integer default null, p_month integer default null
)
returns table (
  barangay_id uuid, barangay_name text, total_points numeric,
  compliance_rate numeric, current_rank bigint, status text
)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select s.*, row_number() over (partition by s.barangay_id order by coalesce(s.last_submitted_at,s.submitted_at,s.created_at) desc) as rn
    from submissions s left join compliance_periods cp on cp.id=s.compliance_period_id
    where (p_compliance_period_id is null or s.compliance_period_id = p_compliance_period_id)
      and (p_compliance_period_id is not null or p_year is null or cp.compliance_year = p_year)
      and (p_compliance_period_id is not null or p_month is null or extract(month from cp.deadline_at) = p_month)
  ), latest as (select * from scoped where rn = 1), ranked as (
    select b.id barangay_id, b.name barangay_name, coalesce(l.points_awarded,0) total_points,
      case when l.status = 'approved' then 100 else 0 end::numeric compliance_rate,
      case l.score_band when 'on_time' then 'Advanced' when 'grace_period' then 'On time' when 'late' then 'Late' else coalesce(l.status::text,'Pending') end status
    from barangays b left join latest l on l.barangay_id=b.id where b.is_active
  )
  select barangay_id, barangay_name, total_points, compliance_rate,
    rank() over(order by total_points desc, barangay_name) as current_rank, status
  from ranked;
$$;
grant execute on function public.leaderboard_for_compliance_period(uuid, integer, integer) to authenticated;

create or replace function public.mandate_compliance_for_period(
  p_compliance_period_id uuid default null, p_year integer default null, p_month integer default null
)
returns table (mandate_id uuid, title text, category text, compliant_barangays integer, total_barangays integer)
language sql stable security definer set search_path = public as $$
  with active as (select count(*)::integer total from barangays where is_active), pairs as (
    select dm.mandate_id, s.barangay_id
    from submissions s join documents d on d.submission_id=s.id join document_mandates dm on dm.document_id=d.id join compliance_periods cp on cp.id=s.compliance_period_id
    where s.status='approved' and (p_compliance_period_id is null or s.compliance_period_id=p_compliance_period_id)
      and (p_compliance_period_id is not null or p_year is null or cp.compliance_year=p_year)
      and (p_compliance_period_id is not null or p_month is null or extract(month from cp.deadline_at)=p_month)
  )
  select m.id,m.title,m.category,coalesce(count(distinct p.barangay_id),0)::integer,a.total
  from mandates m cross join active a left join pairs p on p.mandate_id=m.id
  where m.status='active' group by m.id,m.title,m.category,a.total order by m.title;
$$;
grant execute on function public.mandate_compliance_for_period(uuid, integer, integer) to authenticated;
