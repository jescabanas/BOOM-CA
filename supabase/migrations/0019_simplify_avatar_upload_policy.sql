-- Transitional avatar policies retained to match the deployed v21 history.
drop policy if exists storage_avatar_upload_own on storage.objects;
create policy storage_avatar_upload_any_authenticated on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists storage_avatar_update_own on storage.objects;
create policy storage_avatar_update_any_authenticated on storage.objects
  for update to authenticated using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

drop policy if exists storage_avatar_delete_own on storage.objects;
create policy storage_avatar_delete_any_authenticated on storage.objects
  for delete to authenticated using (bucket_id = 'avatars');
