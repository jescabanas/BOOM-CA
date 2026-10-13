-- Require evidence when a draft is submitted, resubmitted or approved.
-- Existing history remains intact. Removing a file while revising is allowed;
-- sending the revision back to review requires another current attachment.
create function app_private.require_submission_evidence()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.compliance_period_id is not null
    and (new.status in ('under_review','approved'))
    and (tg_op = 'INSERT' or new.status is distinct from old.status
      or new.last_submitted_at is distinct from old.last_submitted_at
      or new.submitted_at is distinct from old.submitted_at) then
    if not exists (
      select 1 from public.documents d
      join storage.objects o on o.bucket_id = 'mov-documents' and o.name = d.storage_path
      where d.submission_id = new.id and d.is_current and d.file_size_bytes > 0
        and exists (select 1 from public.document_mandates dm where dm.document_id = d.id)
    ) then raise exception 'Attach at least one MOV file with a mandate category before submitting or approving compliance.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.require_submission_evidence() from public, anon, authenticated;
create trigger require_submission_evidence before insert or update on public.submissions
for each row execute function app_private.require_submission_evidence();

-- Check every RPC call, even if two resubmissions share the same transaction
-- timestamp and the conditional row trigger therefore sees no timestamp change.
do $$ declare definition text; begin
  definition := pg_get_functiondef('app_private.submit_compliance_submission(uuid,text)'::regprocedure);
  if position('update submissions set' in definition) = 0 then raise exception 'Unexpected submission implementation'; end if;
  definition := replace(definition,'update submissions set',
    'if not exists (select 1 from public.documents d join storage.objects o on o.bucket_id = ''mov-documents'' and o.name = d.storage_path
      where d.submission_id = p_submission_id and d.is_current and d.file_size_bytes > 0
      and exists (select 1 from public.document_mandates dm where dm.document_id = d.id))
      then raise exception ''Attach at least one MOV file with a mandate category before submitting compliance.''; end if;
    update submissions set');
  execute definition;
end $$;

-- Insert the attachment and its mandate links together: failed validation
-- cannot leave half an attachment behind and block the next submission.
create function public.add_submission_document(p_submission_id uuid, p_file jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare sub public.submissions; new_id uuid;
begin
  sub := app_private.lock_document_revision_submission(p_submission_id);
  if nullif(trim(p_file->>'file_name'),'') is null
    or nullif(trim(p_file->>'file_type'),'') is null
    or split_part(p_file->>'storage_path','/',1) is distinct from sub.barangay_id::text
    or split_part(p_file->>'storage_path','/',2) is distinct from sub.id::text
    or coalesce((p_file->>'file_size_bytes')::bigint,0) <= 0
    or jsonb_typeof(p_file->'mandate_ids') is distinct from 'array' then
    raise exception 'An evidence file and mandate categories are required';
  end if;
  if jsonb_array_length(p_file->'mandate_ids') = 0 then raise exception 'Select at least one mandate category'; end if;
  if not exists(select 1 from storage.objects where bucket_id='mov-documents' and name=p_file->>'storage_path') then
    raise exception 'Upload the evidence file before saving';
  end if;
  insert into public.documents(submission_id,file_name,storage_path,file_type,file_size_bytes,uploaded_by)
  values(sub.id,p_file->>'file_name',p_file->>'storage_path',p_file->>'file_type',(p_file->>'file_size_bytes')::bigint,auth.uid()) returning id into new_id;
  insert into public.document_mandates(document_id,mandate_id)
  select distinct new_id,value::uuid from jsonb_array_elements_text(p_file->'mandate_ids');
  return new_id;
end;
$$;
revoke all on function public.add_submission_document(uuid,jsonb) from public, anon;
grant execute on function public.add_submission_document(uuid,jsonb) to authenticated;

-- Serialize attachment writes with submit/review so an approval cannot race
-- with the removal of its last file. Retired versions remain available to staff.
-- A secretary cannot lock an under-review submission directly under RLS.
-- Reuse the narrowly scoped, MFA-protected helper for the row lock instead.
create function app_private.serialize_document_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare sub_id uuid;
begin
  sub_id := case when tg_op='DELETE' then old.submission_id else new.submission_id end;
  if public.current_role_name()='barangay_secretary' then
    perform app_private.lock_document_revision_submission(sub_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.serialize_document_revision() from public, anon, authenticated;
create trigger serialize_document_revision before insert or update or delete on public.documents
for each row execute function app_private.serialize_document_revision();

alter table public.account_applications
  add column document_requirements_version smallint not null default 1,
  add column authentication_of_office_path text,
  add column authentication_of_office_name text,
  add column authentication_of_office_type text,
  add column authentication_of_office_size integer,
  add column pds_path text,
  add column pds_name text,
  add column pds_type text,
  add column pds_size integer;
alter table public.account_applications alter column document_requirements_version set default 2;
alter table public.account_applications add constraint account_application_three_documents check (
  document_requirements_version = 1 or (
    document_requirements_version = 2
    and coalesce(length(authentication_of_office_path)>0,false)
    and coalesce(length(authentication_of_office_name) between 1 and 180,false)
    and coalesce(authentication_of_office_type in ('application/pdf','image/png','image/jpeg'),false)
    and coalesce(authentication_of_office_size between 1 and 10485760,false)
    and coalesce(length(pds_path)>0,false)
    and coalesce(length(pds_name) between 1 and 180,false)
    and coalesce(pds_type in ('application/pdf','image/png','image/jpeg'),false)
    and coalesce(pds_size between 1 and 10485760,false)
  )
);
create function app_private.require_application_document_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.document_requirements_version := 2;
  return new;
end;
$$;
revoke all on function app_private.require_application_document_version() from public,anon,authenticated;
create trigger require_application_document_version before insert on public.account_applications
for each row execute function app_private.require_application_document_version();
