-- One compliance submission per barangay and compliance period.
-- This migration preserves legacy mandate-period submissions so existing history
-- remains available while new submissions use compliance_periods.

-- Upgrade databases where migration 0007 was already applied with the old
-- internal HUC Administrator enum label. Fresh installations already have
-- huc_director, so this safely does nothing there.
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'huc_administrator'
  ) then
    alter type user_role rename value 'huc_administrator' to 'huc_director';
  end if;
end;
$$;

-- The already-deployed 0007 function may still contain the old enum label.
-- Replace it immediately after the rename so RLS can read profiles again.
create or replace function is_staff()
returns boolean
language sql stable security definer as $$
  select current_role_name() in ('super_admin', 'huc_director');
$$;

create table compliance_periods (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  compliance_year integer not null,
  period_label text not null default 'Annual',
  deadline_at timestamptz not null,
  grace_period_hours integer not null default 48 check (grace_period_hours >= 0),
  is_open boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title, compliance_year, period_label)
);

create index idx_compliance_periods_deadline on compliance_periods(deadline_at);
create trigger trg_compliance_periods_updated before update on compliance_periods
  for each row execute function set_updated_at();

alter table submissions add column compliance_period_id uuid references compliance_periods(id) on delete cascade;
alter table submissions alter column mandate_period_id drop not null;
alter table submissions add column submission_notes text;
alter table submissions add column last_submitted_at timestamptz;
alter table submissions drop constraint if exists submissions_barangay_id_mandate_period_id_key;
create unique index submissions_one_per_compliance_period
  on submissions(barangay_id, compliance_period_id) where compliance_period_id is not null;
create unique index submissions_one_per_legacy_mandate_period
  on submissions(barangay_id, mandate_period_id) where mandate_period_id is not null;
create index idx_submissions_compliance_period on submissions(compliance_period_id);

-- A document may support several mandate categories.  The legacy documents
-- table remains the single MOV/file record; this is only its category link.
create table document_mandates (
  document_id uuid not null references documents(id) on delete cascade,
  mandate_id uuid not null references mandates(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (document_id, mandate_id)
);
create index idx_document_mandates_mandate on document_mandates(mandate_id);

-- Remarks are append-only so secretaries can see every review decision and
-- the precise MOV/category to which a correction applies.
create table submission_remarks (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references submissions(id) on delete cascade,
  author_id uuid not null references profiles(id),
  remark text not null check (length(trim(remark)) > 0),
  document_id uuid references documents(id) on delete set null,
  mandate_id uuid references mandates(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_submission_remarks_submission on submission_remarks(submission_id, created_at desc);

alter table compliance_periods enable row level security;
alter table document_mandates enable row level security;
alter table submission_remarks enable row level security;

create policy compliance_periods_read_authenticated on compliance_periods
  for select using (auth.uid() is not null);
create policy compliance_periods_staff_manage on compliance_periods
  for all using (is_staff()) with check (is_staff());

create policy document_mandates_select on document_mandates
  for select using (
    is_staff() or exists (
      select 1 from documents d join submissions s on s.id = d.submission_id
      where d.id = document_mandates.document_id and s.barangay_id = current_barangay_id()
    )
  );
create policy document_mandates_secretary_insert on document_mandates
  for insert with check (
    current_role_name() = 'barangay_secretary' and exists (
      select 1 from documents d join submissions s on s.id = d.submission_id
      where d.id = document_mandates.document_id and s.barangay_id = current_barangay_id()
        and s.is_locked = false and s.status in ('pending', 'correction_requested')
    )
  );
create policy document_mandates_secretary_delete on document_mandates
  for delete using (
    current_role_name() = 'barangay_secretary' and exists (
      select 1 from documents d join submissions s on s.id = d.submission_id
      where d.id = document_mandates.document_id and s.barangay_id = current_barangay_id()
        and s.is_locked = false and s.status in ('pending', 'correction_requested')
    )
  );

create policy submission_remarks_select on submission_remarks
  for select using (
    is_staff() or exists (
      select 1 from submissions s
      where s.id = submission_remarks.submission_id and s.barangay_id = current_barangay_id()
    )
  );
create policy submission_remarks_staff_insert on submission_remarks
  for insert with check (is_staff() and author_id = auth.uid());

-- Secretaries submit through the narrowly scoped RPC below.  Removing their
-- broad update policy prevents a client from changing review status, reviewer,
-- or ownership fields directly.
drop policy if exists submissions_secretary_update on submissions;
drop policy if exists documents_insert on documents;
create policy documents_insert on documents
  for insert with check (
    current_role_name() = 'barangay_secretary' and exists (
      select 1 from submissions s where s.id = documents.submission_id
        and s.barangay_id = current_barangay_id() and s.is_locked = false
        and s.status in ('pending', 'correction_requested')
    )
  );

-- Uploading is now a draft action.  Only the explicit submit RPC changes a
-- submission to the review queue, so several MOVs form one submission.
create or replace function handle_document_upload()
returns trigger
language plpgsql security definer as $$
begin
  perform log_audit_event(new.uploaded_by, 'UPLOAD', 'documents', new.id,
    jsonb_build_object('submission_id', new.submission_id, 'file_name', new.file_name));
  return new;
end;
$$;

create or replace function calculate_submission_score(p_submission_id uuid)
returns table(points numeric, band score_band)
language plpgsql security definer as $$
declare
  v_submission submissions%rowtype;
  v_deadline timestamptz;
  v_grace_hours integer;
  v_max_points numeric := 5;
begin
  select * into v_submission from submissions where id = p_submission_id;
  if not found then raise exception 'Submission % not found', p_submission_id; end if;

  if v_submission.compliance_period_id is not null then
    select deadline_at, grace_period_hours into v_deadline, v_grace_hours
      from compliance_periods where id = v_submission.compliance_period_id;
  else
    select mp.deadline_at, mp.grace_period_hours, m.max_points
      into v_deadline, v_grace_hours, v_max_points
      from mandate_periods mp join mandates m on m.id = mp.mandate_id
      where mp.id = v_submission.mandate_period_id;
  end if;

  if v_submission.status = 'rejected' then
    return query select 0::numeric, 'rejected'::score_band;
  elsif v_submission.submitted_at is null then
    return query select 0::numeric, 'missing'::score_band;
  elsif v_submission.submitted_at <= v_deadline then
    return query select v_max_points, 'on_time'::score_band;
  elsif v_submission.submitted_at <= v_deadline + make_interval(hours => v_grace_hours) then
    return query select least(3::numeric, v_max_points), 'grace_period'::score_band;
  end if;
  return query select 0::numeric, 'late'::score_band;
end;
$$;

create or replace function submit_compliance_submission(p_submission_id uuid, p_notes text default null)
returns submissions
language plpgsql security definer
set search_path = public as $$
declare v_submission submissions%rowtype;
begin
  select * into v_submission from submissions where id = p_submission_id for update;
  if not found or v_submission.barangay_id <> current_barangay_id()
     or current_role_name() <> 'barangay_secretary' then
    raise exception 'You may only submit your barangay compliance record';
  end if;
  if v_submission.compliance_period_id is null or v_submission.is_locked or v_submission.status = 'approved' then
    raise exception 'This compliance submission is not available for submission';
  end if;
  update submissions set
    submitted_by = auth.uid(),
    submitted_at = coalesce(submitted_at, now()),
    last_submitted_at = now(),
    submission_notes = nullif(trim(coalesce(p_notes, '')), ''),
    status = 'under_review',
    evaluator_id = null,
    evaluator_remarks = null,
    reviewed_at = null
  where id = p_submission_id returning * into v_submission;

  insert into notifications (recipient_id, type, title, message, related_submission_id)
  select p.id, 'submission_received', 'Compliance submission received',
         'A barangay compliance submission is ready for review.', v_submission.id
  from profiles p where p.role = 'huc_director' and p.is_active = true;
  perform log_audit_event(auth.uid(), 'SUBMIT', 'submissions', v_submission.id, '{}'::jsonb);
  return v_submission;
end;
$$;

-- This function creates the one allowed draft per barangay/compliance period.
create or replace function create_compliance_submission(p_compliance_period_id uuid)
returns submissions
language plpgsql security definer
set search_path = public as $$
declare v_submission submissions%rowtype;
begin
  if current_role_name() <> 'barangay_secretary' then raise exception 'Secretary role required'; end if;
  if not exists (select 1 from compliance_periods where id = p_compliance_period_id and is_open) then
    raise exception 'This compliance period is not open';
  end if;
  insert into submissions (barangay_id, compliance_period_id, submitted_by)
  values (current_barangay_id(), p_compliance_period_id, auth.uid())
  on conflict (barangay_id, compliance_period_id) where compliance_period_id is not null
  do update set updated_at = submissions.updated_at
  returning * into v_submission;
  return v_submission;
end;
$$;

-- A review decision is coupled with an immutable remark when one is supplied.
create or replace function review_compliance_submission(
  p_submission_id uuid, p_status submission_status, p_remark text default null,
  p_document_id uuid default null, p_mandate_id uuid default null
) returns submissions
language plpgsql security definer
set search_path = public as $$
declare v_submission submissions%rowtype;
begin
  if not is_staff() then raise exception 'Staff role required'; end if;
  if p_status not in ('approved', 'rejected', 'correction_requested', 'under_review') then
    raise exception 'Invalid review status';
  end if;
  if p_status in ('rejected', 'correction_requested') and nullif(trim(coalesce(p_remark, '')), '') is null then
    raise exception 'Remarks are required for a returned or rejected submission';
  end if;
  select * into v_submission from submissions where id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if p_document_id is not null and not exists (select 1 from documents where id = p_document_id and submission_id = p_submission_id) then
    raise exception 'Selected MOV does not belong to this submission';
  end if;
  update submissions set status = p_status, evaluator_id = auth.uid(),
    evaluator_remarks = nullif(trim(coalesce(p_remark, '')), ''), reviewed_at = now(),
    correction_requested_at = case when p_status = 'correction_requested' then now() else correction_requested_at end
  where id = p_submission_id returning * into v_submission;
  if nullif(trim(coalesce(p_remark, '')), '') is not null then
    insert into submission_remarks (submission_id, author_id, remark, document_id, mandate_id)
    values (p_submission_id, auth.uid(), trim(p_remark), p_document_id, p_mandate_id);
  end if;
  return v_submission;
end;
$$;

grant execute on function create_compliance_submission(uuid) to authenticated;
grant execute on function submit_compliance_submission(uuid, text) to authenticated;
grant execute on function review_compliance_submission(uuid, submission_status, text, uuid, uuid) to authenticated;
