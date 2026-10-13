-- Revoke system access without deleting account identities or historical files.
alter table app_private.mfa_resets
  add column access_removed_at timestamptz,
  add column access_removed_by uuid references public.profiles(id);

do $$
declare definition text;
begin
  select pg_get_functiondef('app_private.mfa_access_allowed()'::regprocedure) into definition;
  if position('if reset.blocked then return false; end if;' in definition)=0 then
    raise exception 'Unexpected MFA access gate';
  end if;
  execute replace(definition,'if reset.blocked then return false; end if;',
    'if reset.blocked or reset.access_removed_at is not null then return false; end if;');
end $$;

create function app_private.prevent_removed_account_activation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.is_active and exists(select 1 from app_private.mfa_resets
    where user_id=new.id and access_removed_at is not null) then
    raise exception 'This account was removed from the system. Approve a new account instead.';
  end if;
  return new;
end $$;
revoke all on function app_private.prevent_removed_account_activation() from public,anon,authenticated;
create trigger removed_account_activation_guard before update of is_active on public.profiles
for each row execute function app_private.prevent_removed_account_activation();

create function app_private.list_system_users() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_mfa();
  if not exists(select 1 from public.profiles where id=auth.uid() and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,
    'role',p.role,'barangay_id',p.barangay_id,'barangays',jsonb_build_object('name',b.name),
    'is_active',p.is_active,'access_removed_at',r.access_removed_at) order by p.created_at desc)
    from public.profiles p left join public.barangays b on b.id=p.barangay_id
    left join app_private.mfa_resets r on r.user_id=p.id),'[]'::jsonb);
end $$;
revoke all on function app_private.list_system_users() from public,anon;
grant execute on function app_private.list_system_users() to authenticated;
create function public.list_system_users() returns jsonb language sql stable security invoker set search_path=''
as $$ select app_private.list_system_users() $$;
revoke all on function public.list_system_users() from public,anon;
grant execute on function public.list_system_users() to authenticated;

create function app_private.remove_system_user(p_user_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.profiles; actor uuid:=auth.uid();
begin
  perform app_private.require_mfa();
  if not exists(select 1 from public.profiles where id=actor and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  if p_user_id=actor then raise exception 'You cannot remove your own account'; end if;
  if p_reason is null or length(trim(p_reason)) not between 10 and 1000 then
    raise exception 'Enter a reason of 10–1000 characters';
  end if;
  select * into target from public.profiles where id=p_user_id;
  if target.id is null then raise exception 'Account not found'; end if;
  if target.barangay_id is not null then
    perform 1 from public.barangays where id=target.barangay_id for update;
  end if;
  -- Serialize administrator removals and recheck the actor after waiting.
  perform 1 from public.profiles where role='super_admin' and is_active order by id for update;
  perform app_private.require_mfa();
  select * into target from public.profiles where id=p_user_id for update;
  if not exists(select 1 from public.profiles where id=actor and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  if target.id is null then raise exception 'Account not found'; end if;
  if exists(select 1 from app_private.mfa_resets where user_id=target.id and access_removed_at is not null) then
    return jsonb_build_object('success',true,'already_removed',true);
  end if;
  perform app_private.invalidate_secretary_sessions(target.id);
  update app_private.mfa_resets set access_removed_at=clock_timestamp(),access_removed_by=actor where user_id=target.id;
  update public.profiles set is_active=false where id=target.id;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(actor,'USER_ACCESS_REMOVED','profiles',target.id,
      jsonb_build_object('email',target.email,'role',target.role,'barangay_id',target.barangay_id,'reason',trim(p_reason)));
  return jsonb_build_object('success',true);
end $$;
revoke all on function app_private.remove_system_user(uuid,text) from public,anon;
grant execute on function app_private.remove_system_user(uuid,text) to authenticated;
create function public.remove_system_user(p_user_id uuid,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.remove_system_user(p_user_id,p_reason) $$;
revoke all on function public.remove_system_user(uuid,text) from public,anon;
grant execute on function public.remove_system_user(uuid,text) to authenticated;

-- Expose the removal status to the handover UI without exposing private reset data.
create or replace function app_private.list_secretary_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_mfa();
  if not exists(select 1 from public.profiles where id=auth.uid() and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,
    'barangay_id',p.barangay_id,'barangay_name',b.name,'is_active',p.is_active,
    'access_blocked',coalesce(r.blocked,false),'access_removed_at',r.access_removed_at))
    from public.profiles p left join public.barangays b on b.id=p.barangay_id
    left join app_private.mfa_resets r on r.user_id=p.id where p.role='barangay_secretary'),'[]'::jsonb);
end $$;
notify pgrst,'reload schema';
