begin;
do $$
declare test_id uuid:=gen_random_uuid(); test_user uuid:=gen_random_uuid(); admin_id uuid; v_barangay_id uuid; result_id uuid; n integer; i integer;
begin
 select id into admin_id from public.profiles where role='super_admin' and is_active limit 1;
 select id into v_barangay_id from public.barangays where is_active limit 1;
 if admin_id is null or v_barangay_id is null then raise exception 'Active administrator and barangay required'; end if;
 -- Unloginable synthetic Auth row exists only in this rolled-back transaction.
 -- No Auth API call, invitation, email, password or persistent account is created.
 insert into auth.users(id,email,aud,role) values(test_user,test_user||'@example.invalid','authenticated','authenticated');
 insert into public.account_applications(id,full_name,email,barangay_id,proof_path,proof_name,proof_type,proof_size,setup_redirect,status,provisioned_user_id,processing_at)
 values(test_id,'Transactional workflow test',test_user||'@example.invalid',v_barangay_id,test_id||'/proof.pdf','proof.pdf','application/pdf',10,'https://dilgtest2.netlify.app/reset-password.html','approving',test_user,now());
 set local role service_role;
 select public.finalize_account_application(test_id,admin_id) into result_id;
 if result_id<>test_user then raise exception 'Wrong account was finalized'; end if;
 select count(*) into n from public.profiles where id=test_user and role='barangay_secretary' and barangay_id=v_barangay_id;
 if n<>1 then raise exception 'Secretary profile missing'; end if;
 select count(*) into n from public.account_applications where id=test_id and status='approved' and reviewed_by=admin_id;
 if n<>1 then raise exception 'Approval missing'; end if;
 select count(*) into n from public.audit_logs where entity_id=test_id and action='ACCOUNT_APPLICATION_APPROVED';
 if n<>1 then raise exception 'Approval audit missing'; end if;
 for i in 1..3 loop
  if not public.consume_account_application_attempt(test_user||'@example.invalid') then raise exception 'Valid attempt unexpectedly denied'; end if;
 end loop;
 if public.consume_account_application_attempt(test_user||'@example.invalid') then raise exception 'Fourth attempt allowed'; end if;
 reset role;
end;
$$;
rollback;
select 'PASS: service-role finalization creates the fixed Secretary profile, approval and audit atomically; per-email limit enforced; all fixtures rolled back.' result;
