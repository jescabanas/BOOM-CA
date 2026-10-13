-- Lets a user update their own profile without relying on a self-referential
-- RLS expression, while separately preventing self-service role changes.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create or replace function prevent_self_role_change()
returns trigger
language plpgsql security definer as $$
begin
  if new.role is distinct from old.role and current_role_name() <> 'super_admin' then
    raise exception 'You cannot change your own role.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_change on profiles;
create trigger trg_prevent_self_role_change
  before update on profiles
  for each row execute function prevent_self_role_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
