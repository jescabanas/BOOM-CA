-- Archive attachments rather than deleting evidence or director remarks.
-- Callers retain their own RLS permissions, including the restrictive MFA policy.
revoke update on public.documents from authenticated;
grant update (is_current) on public.documents to authenticated;

create policy documents_secretary_revision on public.documents
for update to authenticated
using (
  public.current_role_name() = 'barangay_secretary'
  and exists (select 1 from public.submissions s where s.id = documents.submission_id
    and s.barangay_id = public.current_barangay_id() and not s.is_locked
    and s.status in ('pending', 'under_review', 'correction_requested'))
)
with check (
  public.current_role_name() = 'barangay_secretary'
  and exists (select 1 from public.submissions s where s.id = documents.submission_id
    and s.barangay_id = public.current_barangay_id() and not s.is_locked
    and s.status in ('pending', 'under_review', 'correction_requested'))
);

-- Under-review submissions intentionally forbid direct secretary UPDATE.
-- This internal helper only locks an owned, editable row; it never updates it.
create function app_private.lock_document_revision_submission(p_submission_id uuid)
returns public.submissions language plpgsql security definer set search_path = '' as $$
declare sub public.submissions;
begin
  if auth.uid() is null or not app_private.mfa_access_allowed()
    or public.current_role_name() <> 'barangay_secretary' then
    raise exception 'An active MFA-verified barangay secretary is required' using errcode = '42501';
  end if;
  select * into sub from public.submissions where id = p_submission_id
    and barangay_id = public.current_barangay_id() for update;
  if sub.id is null or sub.is_locked or sub.status not in ('pending', 'under_review', 'correction_requested') then
    raise exception 'This submission cannot be revised' using errcode = '42501';
  end if;
  return sub;
end;
$$;
revoke all on function app_private.lock_document_revision_submission(uuid) from public, anon;
grant execute on function app_private.lock_document_revision_submission(uuid) to authenticated;

create function public.revise_submission_document(p_document_id uuid, p_replacement jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare old_doc public.documents; sub public.submissions; new_id uuid;
begin
  if auth.uid() is null or public.current_role_name() <> 'barangay_secretary' then
    raise exception 'Barangay secretary required' using errcode = '42501';
  end if;
  select * into old_doc from public.documents where id = p_document_id;
  if old_doc.id is null then raise exception 'Attachment unavailable' using errcode = '42501'; end if;
  -- Serialize revisions with submission reviews and resubmissions.
  sub := app_private.lock_document_revision_submission(old_doc.submission_id);
  if sub.id is null or sub.barangay_id is distinct from public.current_barangay_id()
    or sub.is_locked or sub.status not in ('pending', 'under_review', 'correction_requested') then
    raise exception 'This submission cannot be revised' using errcode = '42501';
  end if;
  select * into old_doc from public.documents where id = p_document_id for update;
  if not old_doc.is_current then raise exception 'This attachment has already been removed or replaced'; end if;
  if p_replacement is not null then
    if nullif(trim(p_replacement->>'file_name'), '') is null
      or nullif(trim(p_replacement->>'file_type'), '') is null
      or split_part(p_replacement->>'storage_path', '/', 1) is distinct from sub.barangay_id::text
      or split_part(p_replacement->>'storage_path', '/', 2) is distinct from sub.id::text
      or coalesce((p_replacement->>'file_size_bytes')::bigint, 0) <= 0
      or jsonb_typeof(p_replacement->'mandate_ids') is distinct from 'array'
      or jsonb_array_length(p_replacement->'mandate_ids') = 0 then
      raise exception 'A replacement file and mandate categories are required';
    end if;
    if not exists(select 1 from storage.objects where bucket_id = 'mov-documents'
      and name = p_replacement->>'storage_path') then
      raise exception 'Upload the replacement file before saving';
    end if;
    insert into public.documents(submission_id,file_name,storage_path,file_type,file_size_bytes,uploaded_by,version)
    values(sub.id,p_replacement->>'file_name',p_replacement->>'storage_path',p_replacement->>'file_type',
      (p_replacement->>'file_size_bytes')::bigint,auth.uid(),old_doc.version + 1) returning id into new_id;
    insert into public.document_mandates(document_id,mandate_id)
      select distinct new_id, value::uuid from jsonb_array_elements_text(p_replacement->'mandate_ids');
  end if;
  -- Any insert/link failure rolls back before the old file is archived.
  update public.documents set is_current = false where id = old_doc.id;
  if not found then raise exception 'Could not revise this attachment' using errcode = '42501'; end if;
  return new_id;
end;
$$;
revoke all on function public.revise_submission_document(uuid,jsonb) from public, anon;
grant execute on function public.revise_submission_document(uuid,jsonb) to authenticated;
