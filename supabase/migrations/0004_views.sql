-- ============================================================================
-- Views & Materialized Views
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_current_leaderboard: live ranking for the current year (all quarters combined)
-- Safe for public read (no PII).
-- ----------------------------------------------------------------------------
create or replace view v_current_leaderboard as
select
  b.id as barangay_id,
  b.name as barangay_name,
  c.name as cluster_name,
  coalesce(sum(s.points_awarded), 0) as total_points,
  count(s.id) as total_mandates,
  count(*) filter (where s.status = 'approved') as completed_mandates,
  case when count(s.id) = 0 then 0
       else round(100.0 * count(*) filter (where s.status = 'approved') / count(s.id), 2)
  end as compliance_rate,
  rank() over (order by coalesce(sum(s.points_awarded), 0) desc) as current_rank
from barangays b
left join clusters c on c.id = b.cluster_id
left join submissions s on s.barangay_id = b.id
left join mandate_periods mp on mp.id = s.mandate_period_id
  and mp.year = extract(year from now())::int
where b.is_active = true
group by b.id, b.name, c.name
order by total_points desc;

-- ----------------------------------------------------------------------------
-- v_director_dashboard_cards: single-row summary for the director dashboard
-- ----------------------------------------------------------------------------
create or replace view v_director_dashboard_cards as
select
  (select count(*) from barangays where is_active = true) as total_barangays,
  (select count(distinct barangay_id) from submissions where status = 'approved') as compliant_barangays,
  (select count(*) from submissions where status in ('pending','under_review')) as pending_submissions,
  (select count(*) from submissions where score_band = 'late') as late_submissions,
  (select count(*) from submissions where status = 'rejected') as rejected_submissions,
  (select count(*) from documents where is_current = true) as total_documents,
  (select round(avg(points_awarded), 2) from submissions where submitted_at is not null) as average_score;

-- ----------------------------------------------------------------------------
-- v_submission_trends: monthly submission volume for charting
-- ----------------------------------------------------------------------------
create or replace view v_submission_trends as
select
  date_trunc('month', submitted_at) as month,
  count(*) as submission_count,
  count(*) filter (where score_band = 'on_time') as on_time_count,
  count(*) filter (where score_band = 'grace_period') as grace_count,
  count(*) filter (where score_band = 'late') as late_count
from submissions
where submitted_at is not null
group by date_trunc('month', submitted_at)
order by month;

-- ----------------------------------------------------------------------------
-- v_mandate_completion: completion rate per mandate (for charting)
-- ----------------------------------------------------------------------------
create or replace view v_mandate_completion as
select
  m.id as mandate_id,
  m.title,
  m.category,
  count(s.id) as total_submissions,
  count(*) filter (where s.status = 'approved') as approved_count,
  case when count(s.id) = 0 then 0
       else round(100.0 * count(*) filter (where s.status = 'approved') / count(s.id), 2)
  end as completion_rate
from mandates m
left join mandate_periods mp on mp.mandate_id = m.id
left join submissions s on s.mandate_period_id = mp.id
group by m.id, m.title, m.category;

-- ----------------------------------------------------------------------------
-- mv_barangay_performance: materialized view for heavy reporting (refreshed by cron)
-- ----------------------------------------------------------------------------
create materialized view mv_barangay_performance as
select
  b.id as barangay_id,
  b.name as barangay_name,
  cl.name as cluster_name,
  mp.year,
  mp.quarter,
  count(s.id) as total_mandates,
  count(*) filter (where s.status = 'approved') as completed_mandates,
  count(*) filter (where s.score_band = 'late') as late_count,
  count(*) filter (where s.status = 'rejected') as rejected_count,
  coalesce(sum(s.points_awarded), 0) as total_points
from barangays b
left join clusters cl on cl.id = b.cluster_id
left join submissions s on s.barangay_id = b.id
left join mandate_periods mp on mp.id = s.mandate_period_id
group by b.id, b.name, cl.name, mp.year, mp.quarter;

create unique index idx_mv_barangay_perf on mv_barangay_performance (barangay_id, year, quarter);

create or replace function refresh_barangay_performance_mv()
returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently mv_barangay_performance;
end;
$$;
