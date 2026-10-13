-- Reapply the v21 avatar policy set. The earlier owner-folder policy was
-- unreliable in this deployment; this mirrors the known-working 0020 policy
-- so profile-picture uploads continue to work after subsequent migrations.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_avatar_upload_open on storage.objects;
drop policy if exists storage_avatar_update_open on storage.objects;
drop policy if exists storage_avatar_delete_open on storage.objects;
drop policy if exists storage_avatar_upload_any_authenticated on storage.objects;
drop policy if exists storage_avatar_update_any_authenticated on storage.objects;
drop policy if exists storage_avatar_delete_any_authenticated on storage.objects;
drop policy if exists avatar_owner_insert on storage.objects;
drop policy if exists avatar_owner_update on storage.objects;
drop policy if exists avatar_owner_delete on storage.objects;

create policy storage_avatar_upload_open on storage.objects
  for insert with check (bucket_id = 'avatars');

create policy storage_avatar_update_open on storage.objects
  for update using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

create policy storage_avatar_delete_open on storage.objects
  for delete using (bucket_id = 'avatars');
