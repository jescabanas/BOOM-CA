-- Preserve prior applications while permitting one new request after removal.
alter table public.account_applications
  add column restoration_user_id uuid references public.profiles(id);
create index account_applications_restoration_user on public.account_applications(restoration_user_id);
drop index public.account_applications_open_email;
create unique index account_applications_open_email on public.account_applications(email)
  where status in ('pending','approving');

-- Public form callers receive only a generic receipt. This lookup is service-only.
create function app_private.secretary_application_account(p_email text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account record;
begin
  select a.id,p.role,p.is_active,r.access_removed_at,a.banned_until into account
    from auth.users a left join public.profiles p on p.id=a.id
    left join app_private.mfa_resets r on r.user_id=a.id
    where lower(a.email)=lower(trim(p_email));
  if not found then return jsonb_build_object('eligible',true,'restoration_user_id',null); end if;
  if account.role='barangay_secretary' and not account.is_active and account.access_removed_at is not null
    and (account.banned_until is null or account.banned_until<=now()) then
    return jsonb_build_object('eligible',true,'restoration_user_id',account.id);
  end if;
  return jsonb_build_object('eligible',false,'restoration_user_id',null);
end $$;
revoke all on function app_private.secretary_application_account(text) from public,anon,authenticated;
grant execute on function app_private.secretary_application_account(text) to service_role;
create function public.secretary_application_account(p_email text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app_private.secretary_application_account(p_email)
$$;
revoke all on function public.secretary_application_account(text) from public,anon,authenticated;
grant execute on function public.secretary_application_account(text) to service_role;

-- Application approval and identity restoration happen in one transaction.
-- Definer access is confined to the private schema; the public wrapper is service-only.
create function app_private.finalize_secretary_application(p_application_id uuid,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.account_applications; target public.profiles; removed_at timestamptz; waiting boolean:=false;
begin
  if not exists(select 1 from public.profiles where id=p_reviewer_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required';
  end if;
  select * into a from public.account_applications where id=p_application_id for update;
  if a.id is null or a.status<>'approving' or a.provisioned_user_id is null then
    raise exception 'Application is not ready for approval';
  end if;
  perform 1 from public.barangays where id=a.barangay_id and is_active for update;
  if not found then raise exception 'Barangay is no longer active'; end if;
  perform 1 from auth.users where id=a.provisioned_user_id and lower(email)=a.email
    and (banned_until is null or banned_until<=now()) for update;
  if not found then raise exception 'Account does not match the application'; end if;
  if a.restoration_user_id is not null then
    if a.provisioned_user_id is distinct from a.restoration_user_id then
      raise exception 'Restore the original account linked to this application';
    end if;
    select * into target from public.profiles where id=a.restoration_user_id for update;
    if target.id is null or target.role<>'barangay_secretary' or target.is_active
      or lower(target.email)<>a.email then
      raise exception 'Only a removed secretary account with the same email can be restored';
    end if;
    perform app_private.invalidate_secretary_sessions(target.id);
    select access_removed_at into removed_at from app_private.mfa_resets where user_id=target.id for update;
    if removed_at is null then raise exception 'This secretary account is no longer removed'; end if;
    if exists(select 1 from app_private.mfa_resets where user_id=target.id and blocked) then
      raise exception 'Complete the account security reset before restoring access';
    end if;
    waiting:=exists(select 1 from public.profiles where barangay_id=a.barangay_id
      and role='barangay_secretary' and is_active and id<>target.id);
    update app_private.mfa_resets set access_removed_at=null,access_removed_by=null where user_id=target.id;
    update public.profiles set full_name=a.full_name,barangay_id=a.barangay_id,is_active=not waiting where id=target.id;
    insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
      values(p_reviewer_id,'SECRETARY_ACCOUNT_RESTORED','profiles',target.id,
        jsonb_build_object('application_id',a.id,'previous_barangay_id',target.barangay_id,
          'barangay_id',a.barangay_id,'waiting_for_handover',waiting,'reason','Returning secretary application approved'));
  else
    if exists(select 1 from public.profiles where id=a.provisioned_user_id or lower(email)=a.email) then
      raise exception 'An existing account cannot be overwritten by a new application';
    end if;
    insert into public.profiles(id,full_name,email,role,barangay_id,is_active)
      values(a.provisioned_user_id,a.full_name,a.email,'barangay_secretary',a.barangay_id,true);
  end if;
  if not exists(select 1 from public.profiles where id=p_reviewer_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required';
  end if;
  update public.account_applications set status='approved',reviewed_by=p_reviewer_id,reviewed_at=now(),processing_at=null where id=a.id;
  insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
    values(p_reviewer_id,'ACCOUNT_APPLICATION_APPROVED','account_applications',a.id,
      jsonb_build_object('user_id',a.provisioned_user_id,'role','barangay_secretary',
        'restored',a.restoration_user_id is not null,'waiting_for_handover',waiting));
  return a.provisioned_user_id;
end $$;
revoke all on function app_private.finalize_secretary_application(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.finalize_secretary_application(uuid,uuid) to service_role;
create or replace function public.finalize_account_application(p_application_id uuid,p_reviewer_id uuid) returns uuid
language sql security invoker set search_path='' as $$
  select app_private.finalize_secretary_application(p_application_id,p_reviewer_id)
$$;
revoke all on function public.finalize_account_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_account_application(uuid,uuid) to service_role;
notify pgrst,'reload schema';
