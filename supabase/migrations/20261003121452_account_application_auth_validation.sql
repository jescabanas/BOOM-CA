-- Keep Auth-table permissions unchanged. The Edge Function verifies the
-- provisioned user's email with auth.admin.getUserById before finalization.
create or replace function public.finalize_account_application(p_application_id uuid,p_reviewer_id uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare a public.account_applications%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_reviewer_id and role='super_admin' and is_active) then raise exception 'Active Super Administrator required'; end if;
 select * into a from public.account_applications where id=p_application_id for update;
 if a.status <> 'approving' or a.provisioned_user_id is null then raise exception 'Application is not ready for approval'; end if;
 if not exists(select 1 from public.barangays where id=a.barangay_id and is_active) then raise exception 'Barangay is no longer active'; end if;
 insert into public.profiles(id,full_name,email,role,barangay_id,is_active)
 values(a.provisioned_user_id,a.full_name,a.email,'barangay_secretary',a.barangay_id,true);
 update public.account_applications set status='approved',reviewed_by=p_reviewer_id,reviewed_at=now(),processing_at=null where id=a.id;
 insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata)
 values(p_reviewer_id,'ACCOUNT_APPLICATION_APPROVED','account_applications',a.id,jsonb_build_object('user_id',a.provisioned_user_id,'role','barangay_secretary'));
 return a.provisioned_user_id;
end;
$$;
revoke all on function public.finalize_account_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_account_application(uuid,uuid) to service_role;
