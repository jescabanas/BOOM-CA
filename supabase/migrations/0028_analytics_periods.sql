-- Analytics can now be scoped to a calendar week, month, quarter, a named
-- compliance deadline ("periodical"), or a full year.
create or replace function public.analytics_period_rankings(
  p_period_type text,
  p_period_value text
)
returns table (
  barangay_id uuid, barangay_name text, total_points numeric,
  compliance_rate numeric, current_rank bigint, is_compliant boolean
)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select s.*
    from submissions s
    join compliance_periods cp on cp.id = s.compliance_period_id
    where case p_period_type
      when 'weekly' then cp.deadline_at >= p_period_value::date
        and cp.deadline_at < p_period_value::date + interval '7 days'
      when 'monthly' then extract(year from cp.deadline_at) = extract(year from current_date)
        and extract(month from cp.deadline_at) = p_period_value::integer
      when 'quarterly' then extract(year from cp.deadline_at) = extract(year from current_date)
        and extract(quarter from cp.deadline_at) = p_period_value::integer
      when 'periodical' then s.compliance_period_id = p_period_value::uuid
      when 'annual' then cp.compliance_year = p_period_value::integer
      else false
    end
  ), latest as (
    select *, row_number() over (
      partition by barangay_id order by coalesce(last_submitted_at, submitted_at, created_at) desc
    ) as rn
    from scoped
  ), summary as (
    select barangay_id,
      count(*) filter (where score_band in ('on_time', 'grace_period'))::numeric as timely_count,
      count(*) filter (where score_band in ('on_time', 'grace_period', 'late'))::numeric as submitted_count
    from scoped group by barangay_id
  ), rows as (
    select b.id barangay_id, b.name barangay_name,
      coalesce(l.points_awarded, 0)::numeric as total_points,
      case when coalesce(s.submitted_count, 0) = 0 then 0::numeric
        else round((s.timely_count / s.submitted_count) * 100, 2) end as compliance_rate,
      coalesce(l.status = 'approved', false) as is_compliant
    from barangays b
    left join summary s on s.barangay_id = b.id
    left join latest l on l.barangay_id = b.id and l.rn = 1
    where b.is_active
  )
  select barangay_id, barangay_name, total_points, compliance_rate,
    rank() over (order by compliance_rate desc, total_points desc,
      nullif(regexp_replace(barangay_name, '\D', '', 'g'), '')::integer nulls last, barangay_name) as current_rank,
    is_compliant
  from rows;
$$;

create or replace function public.analytics_period_mandates(
  p_period_type text,
  p_period_value text
)
returns table (mandate_id uuid, title text, category text, compliant_barangays integer, total_barangays integer)
language sql stable security definer set search_path = public as $$
  with active as (select count(*)::integer total from barangays where is_active), pairs as (
    select dm.mandate_id, s.barangay_id
    from submissions s
    join documents d on d.submission_id = s.id
    join document_mandates dm on dm.document_id = d.id
    join compliance_periods cp on cp.id = s.compliance_period_id
    where s.status = 'approved' and case p_period_type
      when 'weekly' then cp.deadline_at >= p_period_value::date
        and cp.deadline_at < p_period_value::date + interval '7 days'
      when 'monthly' then extract(year from cp.deadline_at) = extract(year from current_date)
        and extract(month from cp.deadline_at) = p_period_value::integer
      when 'quarterly' then extract(year from cp.deadline_at) = extract(year from current_date)
        and extract(quarter from cp.deadline_at) = p_period_value::integer
      when 'periodical' then s.compliance_period_id = p_period_value::uuid
      when 'annual' then cp.compliance_year = p_period_value::integer
      else false
    end
  )
  select m.id, m.title, m.category, coalesce(count(distinct p.barangay_id), 0)::integer, a.total
  from mandates m cross join active a left join pairs p on p.mandate_id = m.id
  where m.status = 'active'
  group by m.id, m.title, m.category, a.total order by m.title;
$$;

grant execute on function public.analytics_period_rankings(text, text) to authenticated, anon;
grant execute on function public.analytics_period_mandates(text, text) to authenticated;

create or replace function public.analytics_period_barangays_for_mandate(
  p_mandate_id uuid, p_period_type text, p_period_value text
)
returns table (barangay_name text)
language sql stable security definer set search_path = public as $$
  select distinct b.name
  from submissions s
  join documents d on d.submission_id = s.id
  join document_mandates dm on dm.document_id = d.id
  join compliance_periods cp on cp.id = s.compliance_period_id
  join barangays b on b.id = s.barangay_id
  where dm.mandate_id = p_mandate_id and s.status = 'approved' and case p_period_type
    when 'weekly' then cp.deadline_at >= p_period_value::date
      and cp.deadline_at < p_period_value::date + interval '7 days'
    when 'monthly' then extract(year from cp.deadline_at) = extract(year from current_date)
      and extract(month from cp.deadline_at) = p_period_value::integer
    when 'quarterly' then extract(year from cp.deadline_at) = extract(year from current_date)
      and extract(quarter from cp.deadline_at) = p_period_value::integer
    when 'periodical' then s.compliance_period_id = p_period_value::uuid
    when 'annual' then cp.compliance_year = p_period_value::integer
    else false
  end
  order by b.name;
$$;

grant execute on function public.analytics_period_barangays_for_mandate(uuid, text, text) to authenticated;
