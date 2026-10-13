-- Transitional policy retained to match the deployed v21 history.
drop policy if exists storage_avatar_upload_any_authenticated on storage.objects;
create policy storage_avatar_upload_open on storage.objects
  for insert with check (bucket_id = 'avatars');

drop policy if exists storage_avatar_update_any_authenticated on storage.objects;
create policy storage_avatar_update_open on storage.objects
  for update using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

drop policy if exists storage_avatar_delete_any_authenticated on storage.objects;
create policy storage_avatar_delete_open on storage.objects
  for delete using (bucket_id = 'avatars');
