-- Preserve account identities and barangay records during secretary handover.
-- Remember revoked sessions so refreshing an old token cannot restore access.
alter table app_private.mfa_resets add column revoked_session_ids uuid[] not null default '{}';

do $$
declare definition text;
begin
  select pg_get_functiondef('app_private.mfa_access_allowed()'::regprocedure) into definition;
  if position('if reset.blocked then return false; end if;' in definition)=0 then
    raise exception 'Unexpected MFA access gate; handover migration stopped';
  end if;
  definition := replace(definition, 'if reset.blocked then return false; end if;',
    'if reset.blocked then return false; end if;
  if (claims->>''session_id'')::uuid = any(reset.revoked_session_ids) then return false; end if;');
  execute definition;
end $$;

create function app_private.invalidate_secretary_sessions(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into app_private.mfa_resets(user_id,tokens_valid_after,revoked_session_ids)
  values(p_user_id,date_trunc('second',clock_timestamp())+interval '1 second',
    array(select id from auth.sessions where user_id=p_user_id))
  on conflict(user_id) do update set
    tokens_valid_after=greatest(app_private.mfa_resets.tokens_valid_after,excluded.tokens_valid_after),
    revoked_session_ids=array(select distinct unnest(app_private.mfa_resets.revoked_session_ids || excluded.revoked_session_ids));
end $$;
revoke all on function app_private.invalidate_secretary_sessions(uuid) from public,anon,authenticated;

-- Serialize assignments for each barangay. A newly approved successor waits
-- without dashboard access until the administrator makes the handover.
create function app_private.enforce_secretary_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role='barangay_secretary' and new.barangay_id is not null then
    perform 1 from public.barangays where id=new.barangay_id for update;
    if new.is_active and exists(select 1 from public.profiles
      where barangay_id=new.barangay_id and role='barangay_secretary' and is_active and id<>new.id) then
      if tg_op='INSERT' then new.is_active:=false;
      else raise exception 'This barangay already has an active secretary. Use Barangay Access to assign a replacement.'; end if;
    end if;
  end if;
  if tg_op='UPDATE' and old.role='barangay_secretary' and
    (old.is_active is distinct from new.is_active or old.barangay_id is distinct from new.barangay_id or old.role is distinct from new.role) then
    perform app_private.invalidate_secretary_sessions(old.id);
  end if;
  return new;
end $$;
revoke all on function app_private.enforce_secretary_assignment() from public,anon,authenticated;
create trigger secretary_assignment_guard before insert or update of role,barangay_id,is_active on public.profiles
for each row execute function app_private.enforce_secretary_assignment();

create function app_private.list_secretary_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_mfa();
  if not exists(select 1 from public.profiles where id=auth.uid() and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,
    'barangay_id',p.barangay_id,'barangay_name',b.name,'is_active',p.is_active,'access_blocked',coalesce(r.blocked,false)))
    from public.profiles p left join public.barangays b on b.id=p.barangay_id
    left join app_private.mfa_resets r on r.user_id=p.id where p.role='barangay_secretary'),'[]'::jsonb);
end $$;
revoke all on function app_private.list_secretary_access() from public,anon;
grant execute on function app_private.list_secretary_access() to authenticated;
create function public.list_secretary_access() returns jsonb language sql stable security invoker set search_path=''
as $$ select app_private.list_secretary_access() $$;
revoke all on function public.list_secretary_access() from public,anon;
grant execute on function public.list_secretary_access() to authenticated;

create function app_private.manage_secretary_access(p_barangay_id uuid,p_user_id uuid,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.profiles; revoked uuid[] := '{}'; actor uuid:=auth.uid();
begin
  perform app_private.require_mfa();
  if not exists(select 1 from public.profiles where id=actor and role='super_admin' and is_active) then
    raise exception 'Super Administrator required' using errcode='42501';
  end if;
  if p_action not in ('remove','assign') or p_action is null or p_reason is null or length(trim(p_reason)) not between 10 and 1000 then
    raise exception 'Choose an action and enter a reason of 10–1000 characters';
  end if;
  perform 1 from public.barangays where id=p_barangay_id and (p_action='remove' or is_active) for update;
  if not found then raise exception 'Active barangay required'; end if;
  select * into target from public.profiles where id=p_user_id for update;
  if target.id is null or target.role<>'barangay_secretary' or target.barangay_id is distinct from p_barangay_id then
    raise exception 'Choose an approved secretary account assigned to this barangay';
  end if;
  if target.id=actor then raise exception 'You cannot change your own access'; end if;
  if p_action='remove' then
    perform app_private.invalidate_secretary_sessions(target.id);
    update public.profiles set is_active=false where id=target.id;
    revoked:=array[target.id];
  else
    if exists(select 1 from app_private.mfa_resets where user_id=target.id and blocked) then
      raise exception 'Complete the account password or authenticator reset before assigning access';
    end if;
    select coalesce(array_agg(id),'{}'::uuid[]) into revoked from public.profiles
      where barangay_id=p_barangay_id and role='barangay_secretary' and is_active and id<>target.id;
    update public.profiles set is_active=false
      where barangay_id=p_barangay_id and role='barangay_secretary' and is_active and id<>target.id;
    update public.profiles set is_active=true where id=target.id;
  end if;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(actor,case when p_action='remove' then 'SECRETARY_ACCESS_REMOVED' else 'SECRETARY_HANDOVER' end,
    'profiles',target.id,jsonb_build_object('barangay_id',p_barangay_id,'email',target.email,'reason',trim(p_reason),'revoked_user_ids',revoked));
  return jsonb_build_object('success',true,'is_active',p_action='assign','revoked_user_ids',revoked);
end $$;
revoke all on function app_private.manage_secretary_access(uuid,uuid,text,text) from public,anon;
grant execute on function app_private.manage_secretary_access(uuid,uuid,text,text) to authenticated;
create function public.manage_secretary_access(p_barangay_id uuid,p_user_id uuid,p_action text,p_reason text) returns jsonb
language sql security invoker set search_path=''
as $$ select app_private.manage_secretary_access(p_barangay_id,p_user_id,p_action,p_reason) $$;
revoke all on function public.manage_secretary_access(uuid,uuid,text,text) from public,anon;
grant execute on function public.manage_secretary_access(uuid,uuid,text,text) to authenticated;

-- Service-only password operation. Authorization is checked by the MFA Edge
-- gate and again against the actor's current role. Block first; fail closed.
create function public.begin_secretary_password_change(p_user_id uuid,p_actor_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare operation uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) or
    p_user_id=p_actor_id or p_reason is null or length(trim(p_reason)) not between 10 and 1000 then
    raise exception 'Active administrator and a handover reason required';
  end if;
  perform 1 from public.profiles where id=p_user_id and role='barangay_secretary' and is_active for update;
  if not found then raise exception 'Active secretary account required'; end if;
  perform app_private.invalidate_secretary_sessions(p_user_id);
  perform 1 from app_private.mfa_resets where user_id=p_user_id for update;
  if exists(select 1 from app_private.mfa_resets where user_id=p_user_id and blocked and started_at>now()-interval '5 minutes') then
    raise exception 'Account security reset already running; retry after five minutes';
  end if;
  update app_private.mfa_resets set blocked=true,operation_id=operation,started_at=now() where user_id=p_user_id;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(p_actor_id,'SECRETARY_PASSWORD_CHANGE_STARTED','profiles',p_user_id,jsonb_build_object('reason',trim(p_reason),'operation_id',operation));
  return operation;
end $$;
create function public.complete_secretary_password_change(p_user_id uuid,p_actor_id uuid,p_operation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) then
    raise exception 'Active administrator required';
  end if;
  perform 1 from public.profiles where id=p_user_id and role='barangay_secretary' and is_active for update;
  if not found then raise exception 'Secretary access was removed; account remains blocked'; end if;
  update app_private.mfa_resets set blocked=false where user_id=p_user_id and operation_id=p_operation_id and blocked;
  if not found then raise exception 'Password operation changed; account remains blocked'; end if;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(p_actor_id,'SECRETARY_PASSWORD_CHANGED','profiles',p_user_id,jsonb_build_object('operation_id',p_operation_id));
end $$;
revoke all on function public.begin_secretary_password_change(uuid,uuid,text),public.complete_secretary_password_change(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_secretary_password_change(uuid,uuid,text),public.complete_secretary_password_change(uuid,uuid,uuid) to service_role;
