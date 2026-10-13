-- ============================================================================
-- Seed Data & Scheduled Jobs
-- NOTE: Replace placeholder barangay names with the real 33 before production use.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Clusters
-- ----------------------------------------------------------------------------
insert into clusters (name, description) values
  ('Cluster A', 'District 1 barangays'),
  ('Cluster B', 'District 2 barangays'),
  ('Cluster C', 'District 3 barangays');

-- ----------------------------------------------------------------------------
-- 33 Barangays (generated placeholders — rename via admin panel before go-live)
-- ----------------------------------------------------------------------------
do $$
declare
  v_cluster_ids uuid[] := array(select id from clusters order by name);
  i integer;
begin
  for i in 1..33 loop
    insert into barangays (code, name, cluster_id)
    values (
      'BRGY-' || lpad(i::text, 3, '0'),
      'Barangay ' || i,
      v_cluster_ids[1 + ((i - 1) % array_length(v_cluster_ids, 1))]
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Sample mandates (the categories listed in the project brief)
-- ----------------------------------------------------------------------------
insert into mandates (title, category, description, max_points) values
  ('Road Clearing', 'Infrastructure', 'Monthly road clearing compliance report', 5),
  ('Peace and Order', 'Peace and Order', 'Barangay peace and order council (BPOC) report', 5),
  ('Disaster Preparedness', 'Disaster Preparedness', 'BDRRM plan and drill documentation', 5),
  ('Financial Transparency', 'Financial Transparency', 'Quarterly financial statement posting', 5),
  ('Environmental Compliance', 'Environmental Compliance', 'Solid waste management compliance', 5),
  ('Health Services', 'Health', 'Barangay health station operations report', 5),
  ('Infrastructure Projects', 'Infrastructure', 'Ongoing infrastructure project MOV', 5),
  ('Education Support', 'Education', 'ALS and school support program report', 5);

-- ----------------------------------------------------------------------------
-- Mandate periods for the current year, Q3 (example — admin creates future ones)
-- ----------------------------------------------------------------------------
insert into mandate_periods (mandate_id, year, quarter, deadline_at, grace_period_hours)
select id, extract(year from now())::int, 3,
       (date_trunc('year', now()) + interval '9 months' - interval '1 day'),
       48
from mandates;

-- ----------------------------------------------------------------------------
-- NOTE ON DEMO ACCOUNTS
-- Supabase Auth users must be created via supabase.auth.admin.createUser()
-- (Admin API / Edge Function) — they cannot be inserted directly into auth.users
-- from a plain SQL migration. See supabase/functions/seed-users for a script
-- that creates the 5 demo accounts (one per role) and their matching profiles.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- CRON JOBS (requires pg_cron extension enabled on the Supabase project)
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Nightly: recalculate scores for anything not yet locked (catches edge cases
-- like a deadline that just passed with no submission => marks as "missing")
select cron.schedule(
  'nightly-score-recalc',
  '15 0 * * *',
  $$ select recalculate_all_scores(); $$
);

-- Nightly: refresh the reporting materialized view
select cron.schedule(
  'nightly-mv-refresh',
  '30 0 * * *',
  $$ select refresh_barangay_performance_mv(); $$
);

-- Hourly: regenerate the current-year ranking snapshot
select cron.schedule(
  'hourly-ranking-snapshot',
  '0 * * * *',
  $$ select generate_ranking_snapshot(extract(year from now())::int, null); $$
);

-- Daily 8am: flag mandate periods whose deadline is within 48 hours and notify secretaries
create or replace function notify_upcoming_deadlines()
returns void language plpgsql security definer as $$
begin
  insert into notifications (recipient_id, type, title, message)
  select p.id, 'deadline_approaching', 'Deadline approaching',
         'Mandate "' || m.title || '" is due ' || to_char(mp.deadline_at, 'Mon DD, YYYY HH24:MI')
  from mandate_periods mp
  join mandates m on m.id = mp.mandate_id
  join profiles p on p.role = 'barangay_secretary'
  where mp.deadline_at between now() and now() + interval '48 hours'
    and mp.is_open = true
    and not exists (
      select 1 from submissions s
      where s.mandate_period_id = mp.id and s.barangay_id = p.barangay_id
        and s.submitted_at is not null
    );
end;
$$;

select cron.schedule(
  'daily-deadline-reminders',
  '0 8 * * *',
  $$ select notify_upcoming_deadlines(); $$
);
