-- Dashboard analytics refinements.
-- One approved submission per barangay is counted once for each mandate it
-- satisfies, whether it uses the legacy mandate period or the newer document
-- to mandate categorisation.
create or replace view v_mandate_completion as
with active_barangays as (
  select count(*)::integer as total_barangays
  from barangays
  where is_active = true
), compliant_pairs as (
  select mp.mandate_id, s.barangay_id
  from submissions s
  join mandate_periods mp on mp.id = s.mandate_period_id
  where s.status = 'approved'

  union

  select dm.mandate_id, s.barangay_id
  from submissions s
  join documents d on d.submission_id = s.id
  join document_mandates dm on dm.document_id = d.id
  where s.status = 'approved'
), mandate_compliance as (
  select mandate_id, count(distinct barangay_id)::integer as compliant_barangays
  from compliant_pairs
  group by mandate_id
)
select
  m.id as mandate_id,
  m.title,
  m.category,
  coalesce(mc.compliant_barangays, 0)::integer as compliant_barangays,
  ab.total_barangays,
  greatest(ab.total_barangays - coalesce(mc.compliant_barangays, 0), 0)::integer as non_compliant_barangays,
  case when ab.total_barangays = 0 then 0
       else round(100.0 * coalesce(mc.compliant_barangays, 0) / ab.total_barangays, 2)
  end as completion_rate
from mandates m
cross join active_barangays ab
left join mandate_compliance mc on mc.mandate_id = m.id;
