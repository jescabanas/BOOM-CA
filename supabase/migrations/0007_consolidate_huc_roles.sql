-- HUC Director is the sole review role. This migration keeps existing
-- installations compatible while fresh installations already use this role.

begin;

create or replace function is_staff()
returns boolean
language sql stable security definer as $$
  select current_role_name() in ('super_admin', 'huc_director');
$$;

drop policy if exists submissions_huc_director_update on submissions;
create policy submissions_huc_director_update on submissions
  for update using (
    current_role_name() in ('huc_director', 'super_admin')
  );

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

  insert into notifications (recipient_id, type, title, message, related_submission_id)
  select p.id, 'submission_received', 'New submission received',
         'A new MOV was uploaded for review.', new.submission_id
  from profiles p
  where p.role = 'huc_director' and p.is_active = true;

  return new;
end;
$$;

commit;
