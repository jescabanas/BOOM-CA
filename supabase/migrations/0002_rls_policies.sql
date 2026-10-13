-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

alter table profiles enable row level security;
alter table barangays enable row level security;
alter table clusters enable row level security;
alter table mandates enable row level security;
alter table mandate_periods enable row level security;
alter table submissions enable row level security;
alter table documents enable row level security;
alter table scores enable row level security;
alter table ranking_snapshots enable row level security;
alter table audit_logs enable row level security;
alter table notifications enable row level security;
alter table system_settings enable row level security;

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, read-only) to avoid recursive RLS checks
-- ----------------------------------------------------------------------------
create or replace function current_role_name()
returns user_role
language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_barangay_id()
returns uuid
language sql stable security definer as $$
  select barangay_id from profiles where id = auth.uid();
$$;

create or replace function is_staff()
returns boolean
language sql stable security definer as $$
  select current_role_name() in ('super_admin','huc_director');
$$;

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
create policy profiles_select_self_or_staff on profiles
  for select using (id = auth.uid() or is_staff());

create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

create policy profiles_admin_all on profiles
  for all using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- ----------------------------------------------------------------------------
-- BARANGAYS / CLUSTERS — public read (leaderboard needs this), admin write
-- ----------------------------------------------------------------------------
create policy barangays_public_read on barangays for select using (true);
create policy barangays_admin_write on barangays
  for insert with check (current_role_name() = 'super_admin');
create policy barangays_admin_update on barangays
  for update using (current_role_name() = 'super_admin');
create policy barangays_admin_delete on barangays
  for delete using (current_role_name() = 'super_admin');

create policy clusters_public_read on clusters for select using (true);
create policy clusters_admin_write on clusters
  for all using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- ----------------------------------------------------------------------------
-- MANDATES / MANDATE_PERIODS — public read, admin write
-- ----------------------------------------------------------------------------
create policy mandates_public_read on mandates for select using (true);
create policy mandates_admin_write on mandates
  for insert with check (current_role_name() = 'super_admin');
create policy mandates_admin_update on mandates
  for update using (current_role_name() = 'super_admin');
create policy mandates_admin_delete on mandates
  for delete using (current_role_name() = 'super_admin');

create policy mandate_periods_public_read on mandate_periods for select using (true);
create policy mandate_periods_admin_write on mandate_periods
  for all using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- ----------------------------------------------------------------------------
-- SUBMISSIONS
--   secretary: full access to their own barangay's rows
--   HUC Director/Super Administrator: read all and update review fields
--   public: read only approved/scored aggregate (handled via public views, not this table)
-- ----------------------------------------------------------------------------
create policy submissions_secretary_select on submissions
  for select using (barangay_id = current_barangay_id() or is_staff());

create policy submissions_secretary_insert on submissions
  for insert with check (
    barangay_id = current_barangay_id()
    and current_role_name() = 'barangay_secretary'
  );

create policy submissions_secretary_update on submissions
  for update using (
    barangay_id = current_barangay_id()
    and current_role_name() = 'barangay_secretary'
    and is_locked = false
  );

create policy submissions_huc_director_update on submissions
  for update using (
    current_role_name() in ('huc_director','super_admin')
  );

-- ----------------------------------------------------------------------------
-- DOCUMENTS — tied to submission ownership
-- ----------------------------------------------------------------------------
create policy documents_select on documents
  for select using (
    is_staff()
    or exists (
      select 1 from submissions s
      where s.id = documents.submission_id
        and s.barangay_id = current_barangay_id()
    )
  );

create policy documents_insert on documents
  for insert with check (
    exists (
      select 1 from submissions s
      where s.id = documents.submission_id
        and s.barangay_id = current_barangay_id()
        and current_role_name() = 'barangay_secretary'
        and s.is_locked = false
    )
  );

-- ----------------------------------------------------------------------------
-- SCORES — read-only for everyone with visibility into the submission
-- ----------------------------------------------------------------------------
create policy scores_select on scores
  for select using (
    is_staff()
    or exists (
      select 1 from submissions s
      where s.id = scores.submission_id
        and s.barangay_id = current_barangay_id()
    )
  );
-- inserts happen only via SECURITY DEFINER trigger function, no direct client policy

-- ----------------------------------------------------------------------------
-- RANKING SNAPSHOTS — public read (leaderboard)
-- ----------------------------------------------------------------------------
create policy rankings_public_read on ranking_snapshots for select using (true);

-- ----------------------------------------------------------------------------
-- AUDIT LOGS — admin only
-- ----------------------------------------------------------------------------
create policy audit_admin_read on audit_logs
  for select using (current_role_name() = 'super_admin');
-- inserts happen only via SECURITY DEFINER helper (log_audit_event), never direct client writes

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS — user sees only their own
-- ----------------------------------------------------------------------------
create policy notifications_select_own on notifications
  for select using (recipient_id = auth.uid());
create policy notifications_update_own on notifications
  for update using (recipient_id = auth.uid());

-- ----------------------------------------------------------------------------
-- SYSTEM SETTINGS — admin only
-- ----------------------------------------------------------------------------
create policy settings_admin_all on system_settings
  for all using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');
create policy settings_staff_read on system_settings
  for select using (is_staff());
