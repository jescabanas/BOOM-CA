-- ============================================================================
-- Storage Buckets & Policies
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mov-documents',
  'mov-documents',
  false, -- private; access via signed URLs only
  104857600, -- 100 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'image/jpeg', 'image/png',
    'video/mp4'
  ]
)
on conflict (id) do nothing;

-- Path convention: mov-documents/{barangay_id}/{submission_id}/{filename}

create policy storage_secretary_upload on storage.objects
  for insert
  with check (
    bucket_id = 'mov-documents'
    and (storage.foldername(name))[1] = current_barangay_id()::text
    and current_role_name() = 'barangay_secretary'
  );

create policy storage_secretary_read_own on storage.objects
  for select
  using (
    bucket_id = 'mov-documents'
    and (
      is_staff()
      or (storage.foldername(name))[1] = current_barangay_id()::text
    )
  );

create policy storage_admin_manage on storage.objects
  for all
  using (bucket_id = 'mov-documents' and current_role_name() = 'super_admin')
  with check (bucket_id = 'mov-documents' and current_role_name() = 'super_admin');
