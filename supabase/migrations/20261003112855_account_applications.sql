-- Public applications are not Auth accounts. Only server-side code can write.
create table public.account_applications (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check (char_length(full_name) between 2 and 120),
 email text not null check (email = lower(trim(email)) and char_length(email) between 5 and 254),
 barangay_id uuid not null references public.barangays(id),
 proof_path text not null unique,
 proof_name text not null check (char_length(proof_name) between 1 and 180),
 proof_type text not null check (proof_type in ('application/pdf','image/png','image/jpeg')),
 proof_size integer not null check (proof_size between 1 and 10485760),
 setup_redirect text not null,
 status text not null default 'pending' check (status in ('pending','approving','approved','denied')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id),
 review_note text check (char_length(review_note) <= 1000),
 processing_at timestamptz,
 provisioned_user_id uuid references auth.users(id),
 setup_email_sent_at timestamptz
);
create unique index account_applications_open_email on public.account_applications(email) where status <> 'denied';
create index account_applications_review_queue on public.account_applications(status,created_at desc);
create index account_applications_barangay on public.account_applications(barangay_id);
create index account_applications_reviewer on public.account_applications(reviewed_by);
create index account_applications_user on public.account_applications(provisioned_user_id);
alter table public.account_applications enable row level security;
revoke all on public.account_applications from anon,authenticated;
grant select on public.account_applications to authenticated;
grant all on public.account_applications to service_role;
create policy account_applications_admin_read on public.account_applications
 for select to authenticated using (exists (
 select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role='super_admin'
 ));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('account-application-proofs','account-application-proofs',false,10485760,array['application/pdf','image/png','image/jpeg']);
create policy account_application_proof_admin_read on storage.objects
 for select to authenticated using (bucket_id='account-application-proofs' and exists (
 select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active and p.role='super_admin'
 ));
-- No public uploads, listing, updates or deletes; uploads go through the bounded Edge endpoint.

create table public.account_application_limits (
 key text primary key, window_start timestamptz not null, attempts integer not null
);
alter table public.account_application_limits enable row level security;
revoke all on public.account_application_limits from anon,authenticated;
grant all on public.account_application_limits to service_role;
create policy account_application_limits_server_only on public.account_application_limits
 for all to service_role using (true) with check (true);

create function public.consume_account_application_attempt(p_email text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare n integer; hour_start timestamptz:=date_trunc('hour',now()); day_start timestamptz:=date_trunc('day',now()); email_key text:='email:'||md5(lower(trim(p_email)));
begin
 -- Atomic global ceilings work across all Edge instances; client IPs are not trusted.
 perform pg_advisory_xact_lock(683174002);
 delete from public.account_application_limits where window_start < now()-interval '2 days';
 insert into public.account_application_limits values ('global-hour',hour_start,1)
 on conflict(key) do update set attempts=case when account_application_limits.window_start=hour_start then account_application_limits.attempts+1 else 1 end,window_start=hour_start returning attempts into n;
 if n>30 then return false; end if;
 insert into public.account_application_limits values ('global-day',day_start,1)
 on conflict(key) do update set attempts=case when account_application_limits.window_start=day_start then account_application_limits.attempts+1 else 1 end,window_start=day_start returning attempts into n;
 if n>100 then return false; end if;
 insert into public.account_application_limits values (email_key,day_start,1)
 on conflict(key) do update set attempts=case when account_application_limits.window_start=day_start then account_application_limits.attempts+1 else 1 end,window_start=day_start returning attempts into n;
 return n<=3;
end;
$$;
revoke all on function public.consume_account_application_attempt(text) from public,anon,authenticated;
grant execute on function public.consume_account_application_attempt(text) to service_role;

create function public.finalize_account_application(p_application_id uuid,p_reviewer_id uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare a public.account_applications%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_reviewer_id and role='super_admin' and is_active) then raise exception 'Active Super Administrator required'; end if;
 select * into a from public.account_applications where id=p_application_id for update;
 if a.status <> 'approving' or a.provisioned_user_id is null then raise exception 'Application is not ready for approval'; end if;
 if not exists(select 1 from public.barangays where id=a.barangay_id and is_active) then raise exception 'Barangay is no longer active'; end if;
 if not exists(select 1 from auth.users where id=a.provisioned_user_id and lower(email)=a.email) then raise exception 'Account does not match the application'; end if;
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
