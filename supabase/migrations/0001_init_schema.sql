-- ============================================================================
-- Smart Governance Platform — Initial Schema
-- DILG Barangay Performance Evaluation System
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
create type user_role as enum (
  'super_admin',
  'huc_director',
  'barangay_secretary',
  'public_user'
);

create type submission_status as enum (
  'pending',
  'under_review',
  'approved',
  'rejected',
  'missing',
  'correction_requested'
);

create type score_band as enum ('on_time', 'grace_period', 'late', 'rejected', 'missing');

create type mandate_status as enum ('active', 'archived', 'draft');

create type notification_type as enum (
  'submission_received',
  'submission_approved',
  'submission_rejected',
  'correction_requested',
  'deadline_approaching',
  'deadline_passed',
  'evaluation_completed',
  'system'
);

-- ----------------------------------------------------------------------------
-- CLUSTERS (grouping of barangays, e.g. geographic districts)
-- ----------------------------------------------------------------------------
create table clusters (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- BARANGAYS
-- ----------------------------------------------------------------------------
create table barangays (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,               -- e.g. "BRGY-001"
  name text not null,
  cluster_id uuid references clusters(id) on delete set null,
  district text,
  population integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_barangays_cluster on barangays(cluster_id);

-- ----------------------------------------------------------------------------
-- PROFILES (extends auth.users)
-- ----------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role user_role not null default 'public_user',
  barangay_id uuid references barangays(id) on delete set null, -- required for barangay_secretary
  phone text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secretary_must_have_barangay
    check (role <> 'barangay_secretary' or barangay_id is not null)
);

create index idx_profiles_role on profiles(role);
create index idx_profiles_barangay on profiles(barangay_id);

-- ----------------------------------------------------------------------------
-- MANDATES (governance categories being evaluated)
-- ----------------------------------------------------------------------------
create table mandates (
  id uuid primary key default uuid_generate_v4(),
  title text not null,                      -- e.g. "Road Clearing"
  category text not null,                   -- e.g. "Peace and Order"
  description text,
  required_file_types text[] not null default '{pdf,docx,xlsx,zip,jpg,png,mp4}',
  max_points integer not null default 5,
  status mandate_status not null default 'active',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each mandate can recur across evaluation periods (quarters/years) with its own deadline
create table mandate_periods (
  id uuid primary key default uuid_generate_v4(),
  mandate_id uuid not null references mandates(id) on delete cascade,
  year integer not null,
  quarter integer check (quarter between 1 and 4),
  deadline_at timestamptz not null,
  grace_period_hours integer not null default 48,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  unique (mandate_id, year, quarter)
);

create index idx_mandate_periods_mandate on mandate_periods(mandate_id);
create index idx_mandate_periods_deadline on mandate_periods(deadline_at);

-- ----------------------------------------------------------------------------
-- SUBMISSIONS (a barangay's response to a mandate period)
-- ----------------------------------------------------------------------------
create table submissions (
  id uuid primary key default uuid_generate_v4(),
  barangay_id uuid not null references barangays(id) on delete cascade,
  mandate_period_id uuid not null references mandate_periods(id) on delete cascade,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,                 -- null until first document is uploaded
  status submission_status not null default 'pending',
  score_band score_band,
  points_awarded numeric(5,2) not null default 0,
  evaluator_id uuid references profiles(id),
  evaluator_remarks text,
  reviewed_at timestamptz,
  correction_requested_at timestamptz,
  is_locked boolean not null default false, -- locked evaluations can't be changed further
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barangay_id, mandate_period_id)
);

create index idx_submissions_barangay on submissions(barangay_id);
create index idx_submissions_period on submissions(mandate_period_id);
create index idx_submissions_status on submissions(status);

-- ----------------------------------------------------------------------------
-- DOCUMENTS (MOV files attached to a submission)
-- ----------------------------------------------------------------------------
create table documents (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references submissions(id) on delete cascade,
  file_name text not null,
  storage_path text not null,               -- path within Supabase Storage bucket
  file_type text not null,
  file_size_bytes bigint,
  version integer not null default 1,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default true, -- false for superseded versions
  checksum text,
  scan_status text not null default 'pending' -- 'pending' | 'clean' | 'flagged' (virus-scan placeholder)
);

create index idx_documents_submission on documents(submission_id);
create index idx_documents_current on documents(submission_id, is_current);

-- ----------------------------------------------------------------------------
-- SCORES (per-submission score history — recalculated automatically)
-- ----------------------------------------------------------------------------
create table scores (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references submissions(id) on delete cascade,
  points numeric(5,2) not null,
  band score_band not null,
  calculated_at timestamptz not null default now(),
  calculation_notes text
);

create index idx_scores_submission on scores(submission_id);

-- ----------------------------------------------------------------------------
-- RANKINGS (materialized snapshot per period — see materialized view too)
-- ----------------------------------------------------------------------------
create table ranking_snapshots (
  id uuid primary key default uuid_generate_v4(),
  year integer not null,
  quarter integer,
  barangay_id uuid not null references barangays(id) on delete cascade,
  total_points numeric(6,2) not null,
  compliance_rate numeric(5,2) not null,     -- percentage
  completed_mandates integer not null,
  total_mandates integer not null,
  rank integer not null,
  generated_at timestamptz not null default now()
);

create index idx_ranking_period on ranking_snapshots(year, quarter);

-- ----------------------------------------------------------------------------
-- AUDIT LOGS
-- ----------------------------------------------------------------------------
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  action text not null,                     -- e.g. 'LOGIN', 'UPLOAD', 'APPROVE', 'ROLE_CHANGE'
  entity_table text,
  entity_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_user on audit_logs(user_id);
create index idx_audit_created on audit_logs(created_at desc);
create index idx_audit_entity on audit_logs(entity_table, entity_id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------------------------
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  message text not null,
  related_submission_id uuid references submissions(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifications_recipient on notifications(recipient_id, is_read);

-- ----------------------------------------------------------------------------
-- SYSTEM SETTINGS
-- ----------------------------------------------------------------------------
create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value) values
  ('scoring_rules', '{"on_time_points": 5, "grace_period_points": 3, "late_points": 0, "default_grace_period_hours": 48}'),
  ('platform_name', '"Smart Governance Platform"');

-- ----------------------------------------------------------------------------
-- updated_at trigger helper (used across tables)
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_barangays_updated before update on barangays
  for each row execute function set_updated_at();
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_mandates_updated before update on mandates
  for each row execute function set_updated_at();
create trigger trg_submissions_updated before update on submissions
  for each row execute function set_updated_at();
