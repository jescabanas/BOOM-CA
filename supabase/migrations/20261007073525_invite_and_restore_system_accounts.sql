-- Service-only helpers called after the Edge Function verifies the admin's MFA.
create function app_private.lookup_user_invitation(p_actor_id uuid,p_email text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required' using errcode='42501';
  end if;
  return (select jsonb_build_object('id',a.id,'has_profile',p.id is not null,
    'is_active',coalesce(p.is_active,false),'role',p.role,
    'banned',a.banned_until>now())
    from auth.users a left join public.profiles p on p.id=a.id
    where lower(a.email)=lower(trim(p_email)));
end $$;

create function app_private.complete_user_invitation(
  p_actor_id uuid,p_user_id uuid,p_full_name text,p_email text,p_role text,
  p_barangay_id uuid,p_restore_existing boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.profiles; restored boolean;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required' using errcode='42501';
  end if;
  if p_user_id=p_actor_id then raise exception 'You cannot invite or change your own account'; end if;
  if p_role is null or p_role not in ('super_admin','huc_director')
    or p_full_name is null or length(trim(p_full_name)) not between 1 and 200
    or p_email is null or length(trim(p_email)) not between 3 and 254 then
    raise exception 'A name, email and Super Administrator or HUC Director role are required';
  end if;
  if p_barangay_id is not null then
    raise exception 'Administrator and director accounts cannot be assigned a barangay';
  end if;
  perform 1 from auth.users where id=p_user_id and lower(email)=lower(trim(p_email))
    and (banned_until is null or banned_until<=clock_timestamp()) for update;
  if not found then raise exception 'An available authentication account with this email is required'; end if;
  select * into target from public.profiles where id=p_user_id for update;
  restored:=found;
  if restored and target.is_active then
    raise exception 'This account is already active. Its role has not been changed. Use Resend setup email.';
  end if;
  if restored and not coalesce(p_restore_existing,false) then
    raise exception 'Confirm Restore removed or disabled account to invite this email again';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required' using errcode='42501';
  end if;
  if restored or exists(select 1 from auth.sessions where user_id=p_user_id) then
    perform app_private.invalidate_secretary_sessions(p_user_id);
  end if;
  if exists(select 1 from app_private.mfa_resets where user_id=p_user_id and blocked) then
    raise exception 'Complete the account security reset before restoring access';
  end if;
  -- Preserve authenticators and revoked sessions; clear only the removal marker.
  update app_private.mfa_resets set access_removed_at=null,access_removed_by=null where user_id=p_user_id;
  if restored then
    update public.profiles set full_name=trim(p_full_name),email=lower(trim(p_email)),
      role=p_role::public.user_role,barangay_id=null,is_active=true where id=p_user_id;
  else
    insert into public.profiles(id,full_name,email,role,barangay_id,is_active)
      values(p_user_id,trim(p_full_name),lower(trim(p_email)),p_role::public.user_role,null,true);
  end if;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(p_actor_id,case when restored then 'USER_ACCESS_RESTORED' else 'USER_CREATED' end,
      'profiles',p_user_id,jsonb_build_object('email',lower(trim(p_email)),'role',p_role,
        'barangay_id',null,'previous_role',target.role,'previous_barangay_id',target.barangay_id,
        'source','admin_console_invitation'));
  return jsonb_build_object('success',true,'restored',restored,'user_id',p_user_id);
end $$;

revoke all on function app_private.lookup_user_invitation(uuid,text),
  app_private.complete_user_invitation(uuid,uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.lookup_user_invitation(uuid,text),
  app_private.complete_user_invitation(uuid,uuid,text,text,text,uuid,boolean) to service_role;
create function public.lookup_user_invitation(p_actor_id uuid,p_email text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app_private.lookup_user_invitation(p_actor_id,p_email)
$$;
create function public.complete_user_invitation(
  p_actor_id uuid,p_user_id uuid,p_full_name text,p_email text,p_role text,
  p_barangay_id uuid,p_restore_existing boolean
) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.complete_user_invitation(p_actor_id,p_user_id,p_full_name,p_email,p_role,p_barangay_id,p_restore_existing)
$$;
revoke all on function public.lookup_user_invitation(uuid,text),
  public.complete_user_invitation(uuid,uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.lookup_user_invitation(uuid,text),
  public.complete_user_invitation(uuid,uuid,text,text,text,uuid,boolean) to service_role;
notify pgrst,'reload schema';
