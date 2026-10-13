-- ============================================================================
-- Automated Scoring Engine (5-3-0 rule) + Audit Logging + Notifications
-- ============================================================================

-- ----------------------------------------------------------------------------
-- log_audit_event: single entry point for writing to audit_logs.
-- SECURITY DEFINER so RLS on audit_logs never blocks legitimate writes,
-- while the table itself has no client-facing insert policy.
-- ----------------------------------------------------------------------------
create or replace function log_audit_event(
  p_user_id uuid,
  p_action text,
  p_entity_table text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer as $$
begin
  insert into audit_logs (user_id, action, entity_table, entity_id, metadata)
  values (p_user_id, p_action, p_entity_table, p_entity_id, p_metadata);
end;
$$;

-- ----------------------------------------------------------------------------
-- notify_user: single entry point for creating notifications
-- ----------------------------------------------------------------------------
create or replace function notify_user(
  p_recipient uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_submission_id uuid default null
)
returns void
language plpgsql security definer as $$
begin
  insert into notifications (recipient_id, type, title, message, related_submission_id)
  values (p_recipient, p_type, p_title, p_message, p_submission_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- calculate_submission_score: the official 5-3-0 rule.
--   before deadline            -> max_points (default 5)
--   within grace period        -> 3
--   after grace period (late)  -> 0
--   rejected                   -> 0
--   missing (no submission)    -> 0
-- Returns (points, band).
-- ----------------------------------------------------------------------------
create or replace function calculate_submission_score(p_submission_id uuid)
returns table(points numeric, band score_band)
language plpgsql security definer as $$
declare
  v_submission submissions%rowtype;
  v_period mandate_periods%rowtype;
  v_mandate mandates%rowtype;
  v_grace_deadline timestamptz;
  v_points numeric;
  v_band score_band;
begin
  select * into v_submission from submissions where id = p_submission_id;
  if not found then
    raise exception 'Submission % not found', p_submission_id;
  end if;

  select * into v_period from mandate_periods where id = v_submission.mandate_period_id;
  select * into v_mandate from mandates where id = v_period.mandate_id;

  v_grace_deadline := v_period.deadline_at + make_interval(hours => v_period.grace_period_hours);

  if v_submission.status = 'rejected' then
    v_points := 0;
    v_band := 'rejected';
  elsif v_submission.submitted_at is null then
    v_points := 0;
    v_band := 'missing';
  elsif v_submission.submitted_at <= v_period.deadline_at then
    v_points := v_mandate.max_points;
    v_band := 'on_time';
  elsif v_submission.submitted_at <= v_grace_deadline then
    v_points := least(3, v_mandate.max_points);
    v_band := 'grace_period';
  else
    v_points := 0;
    v_band := 'late';
  end if;

  return query select v_points, v_band;
end;
$$;

-- ----------------------------------------------------------------------------
-- apply_submission_score: recalculates and persists score + logs history.
-- Called by triggers on submission changes (never by the client directly).
-- ----------------------------------------------------------------------------
create or replace function apply_submission_score()
returns trigger
language plpgsql security definer as $$
declare
  v_result record;
begin
  select * into v_result from calculate_submission_score(new.id);

  update submissions
     set points_awarded = v_result.points,
         score_band = v_result.band
   where id = new.id;

  insert into scores (submission_id, points, band, calculation_notes)
  values (new.id, v_result.points, v_result.band, 'auto-calculated on submission change');

  return new;
end;
$$;

-- Fires after a submission's timestamp/status changes (insert or relevant update)
create trigger trg_score_on_submission
  after insert or update of submitted_at, status on submissions
  for each row execute function apply_submission_score();

-- ----------------------------------------------------------------------------
-- On first document upload: stamp submitted_at (if not already set) and
-- flip status to under_review, which cascades into the scoring trigger above.
-- ----------------------------------------------------------------------------
create or replace function handle_document_upload()
returns trigger
language plpgsql security definer as $$
declare
  v_submission submissions%rowtype;
begin
  select * into v_submission from submissions where id = new.submission_id;

  if v_submission.submitted_at is null then
    update submissions
       set submitted_at = new.uploaded_at,
           status = 'under_review'
     where id = new.submission_id;
  end if;

  perform log_audit_event(new.uploaded_by, 'UPLOAD', 'documents', new.id,
    jsonb_build_object('submission_id', new.submission_id, 'file_name', new.file_name));

  -- notify HUC Directors that a new submission needs review
  insert into notifications (recipient_id, type, title, message, related_submission_id)
  select p.id, 'submission_received', 'New submission received',
         'A new MOV was uploaded for review.', new.submission_id
  from profiles p
  where p.role = 'huc_director' and p.is_active = true;

  return new;
end;
$$;

create trigger trg_document_upload
  after insert on documents
  for each row execute function handle_document_upload();

-- ----------------------------------------------------------------------------
-- On HUC Director approval/rejection: notify the barangay secretary
-- ----------------------------------------------------------------------------
create or replace function handle_submission_review()
returns trigger
language plpgsql security definer as $$
declare
  v_recipient uuid;
begin
  if new.status = old.status then
    return new;
  end if;

  select id into v_recipient
  from profiles
  where barangay_id = new.barangay_id and role = 'barangay_secretary'
  limit 1;

  if v_recipient is not null then
    if new.status = 'approved' then
      perform notify_user(v_recipient, 'submission_approved', 'Submission approved',
        'Your MOV submission has been approved.', new.id);
    elsif new.status = 'rejected' then
      perform notify_user(v_recipient, 'submission_rejected', 'Submission rejected',
        coalesce('Reason: ' || new.evaluator_remarks, 'Your submission was rejected.'), new.id);
    elsif new.status = 'correction_requested' then
      perform notify_user(v_recipient, 'correction_requested', 'Correction requested',
        coalesce(new.evaluator_remarks, 'Please review and resubmit.'), new.id);
    end if;
  end if;

  perform log_audit_event(new.evaluator_id, upper(new.status::text), 'submissions', new.id, '{}'::jsonb);

  return new;
end;
$$;

create trigger trg_submission_review
  after update of status on submissions
  for each row execute function handle_submission_review();

-- ----------------------------------------------------------------------------
-- recalculate_all_scores: admin-triggered bulk recalculation
-- (e.g. after a deadline extension or scoring-rule change)
-- ----------------------------------------------------------------------------
create or replace function recalculate_all_scores()
returns integer
language plpgsql security definer as $$
declare
  v_count integer := 0;
  v_sub record;
  v_result record;
begin
  for v_sub in select id from submissions where is_locked = false loop
    select * into v_result from calculate_submission_score(v_sub.id);
    update submissions set points_awarded = v_result.points, score_band = v_result.band
      where id = v_sub.id;
    insert into scores (submission_id, points, band, calculation_notes)
      values (v_sub.id, v_result.points, v_result.band, 'bulk recalculation');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- generate_ranking_snapshot: computes and stores the leaderboard for a period
-- ----------------------------------------------------------------------------
create or replace function generate_ranking_snapshot(p_year integer, p_quarter integer)
returns void
language plpgsql security definer as $$
begin
  delete from ranking_snapshots where year = p_year and quarter is not distinct from p_quarter;

  insert into ranking_snapshots (year, quarter, barangay_id, total_points, compliance_rate,
                                  completed_mandates, total_mandates, rank)
  select
    p_year,
    p_quarter,
    b.id,
    coalesce(sum(s.points_awarded), 0) as total_points,
    case when count(s.id) = 0 then 0
         else round(100.0 * count(*) filter (where s.status = 'approved') / count(s.id), 2)
    end as compliance_rate,
    count(*) filter (where s.status = 'approved') as completed_mandates,
    count(s.id) as total_mandates,
    rank() over (order by coalesce(sum(s.points_awarded), 0) desc) as rank
  from barangays b
  left join submissions s on s.barangay_id = b.id
  left join mandate_periods mp on mp.id = s.mandate_period_id and mp.year = p_year
    and (p_quarter is null or mp.quarter = p_quarter)
  where b.is_active = true
  group by b.id;
end;
$$;
