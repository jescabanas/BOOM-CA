begin;
do $$
declare test_id uuid:=gen_random_uuid(); admin_id uuid; secretary_id uuid; barangay_id uuid; n integer;
begin
 select id into admin_id from public.profiles where role='super_admin' and is_active limit 1;
 select id into secretary_id from public.profiles where role='barangay_secretary' and is_active limit 1;
 select id into barangay_id from public.barangays where is_active limit 1;
 if admin_id is null or secretary_id is null or barangay_id is null then raise exception 'Permission fixtures require existing active roles'; end if;
 insert into public.account_applications(id,full_name,email,barangay_id,proof_path,proof_name,proof_type,proof_size,setup_redirect)
 values(test_id,'Permission test',test_id||'@example.invalid',barangay_id,test_id||'/proof.pdf','proof.pdf','application/pdf',10,'https://dilgtest2.netlify.app/reset-password.html');
 if has_table_privilege('anon','public.account_applications','SELECT') or has_table_privilege('anon','public.account_applications','INSERT') then raise exception 'Public application table access is exposed'; end if;
 if has_table_privilege('authenticated','public.account_applications','UPDATE') or has_function_privilege('authenticated','public.finalize_account_application(uuid,uuid)','EXECUTE') then raise exception 'Direct approval is exposed'; end if;
 if has_function_privilege('anon','public.consume_account_application_attempt(text)','EXECUTE') then raise exception 'Rate function exposed'; end if;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',secretary_id,'role','authenticated')::text,true);
 set local role authenticated;
 select count(*) into n from public.account_applications where id=test_id;
 if n<>0 then raise exception 'Secretary can read applications'; end if;
 reset role;

 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 set local role authenticated;
 select count(*) into n from public.account_applications where id=test_id;
 if n<>1 then raise exception 'Super Administrator cannot read applications'; end if;
 reset role;
end;
$$;
rollback;
select 'PASS: anonymous access blocked; direct decisions blocked; Secretary cannot read; active Super Administrator can review. Synthetic request rolled back.' result;
