create or replace function public.barangays_compliant_for_mandate(
  p_mandate_id uuid, p_compliance_period_id uuid default null,
  p_year integer default null, p_month integer default null
)
returns table (barangay_id uuid, barangay_name text)
language sql stable security definer set search_path = public as $$
  select distinct b.id, b.name
  from submissions s
  join documents d on d.submission_id = s.id
  join document_mandates dm on dm.document_id = d.id
  join barangays b on b.id = s.barangay_id
  left join compliance_periods cp on cp.id = s.compliance_period_id
  where s.status = 'approved'
    and dm.mandate_id = p_mandate_id
    and (p_compliance_period_id is null or s.compliance_period_id = p_compliance_period_id)
    and (p_compliance_period_id is not null or p_year is null or cp.compliance_year = p_year)
    and (p_compliance_period_id is not null or p_month is null or extract(month from cp.deadline_at) = p_month)
  order by b.name;
$$;

grant execute on function public.barangays_compliant_for_mandate(uuid, uuid, integer, integer) to authenticated;
