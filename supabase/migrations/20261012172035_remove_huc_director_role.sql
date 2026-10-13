-- Retire the HUC Director application role. Existing administrator and
-- secretary accounts keep their permissions. The legacy enum label remains
-- for historical migration compatibility; no profile may use it.
-- Do not promote a legacy director into the more privileged administrator role.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role::text='huc_director') THEN
    RAISE EXCEPTION 'Assign an approved replacement role before retiring Director accounts';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select current_role_name() = 'super_admin';
$function$;


CREATE OR REPLACE FUNCTION app_private.ensure_compliance_schedule_periods(p_year integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_year integer := extract(year from now() at time zone 'Asia/Manila')::integer;
  requested_year integer := coalesce(p_year, current_year);
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and is_active
      and role in ('super_admin','barangay_secretary')
  ) then raise exception 'Active staff or secretary account required'; end if;
  if requested_year < 2026 or requested_year > current_year then
    raise exception 'Select a year from 2026 through the current year';
  end if;
  return public.seed_compliance_calendar(requested_year);
end;
$function$;


CREATE OR REPLACE FUNCTION app_private.submit_compliance_submission(p_submission_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_submission submissions%rowtype;
begin
  select * into v_submission from submissions where id = p_submission_id for update;
  if not found or v_submission.barangay_id <> current_barangay_id()
     or current_role_name() <> 'barangay_secretary' then
    raise exception 'You may only submit your barangay compliance record';
  end if;
  if v_submission.compliance_period_id is null or v_submission.is_locked or v_submission.status = 'approved' then
    raise exception 'This compliance submission is not available for submission';
  end if;
  if not exists (select 1 from public.documents d join storage.objects o on o.bucket_id = 'mov-documents' and o.name = d.storage_path
      where d.submission_id = p_submission_id and d.is_current and d.file_size_bytes > 0
      and exists (select 1 from public.document_mandates dm where dm.document_id = d.id))
      then raise exception 'Attach at least one MOV file with a mandate category before submitting compliance.'; end if;
    update submissions set
    submitted_by = auth.uid(),
    submitted_at = coalesce(submitted_at, now()),
    last_submitted_at = now(),
    submission_notes = nullif(trim(coalesce(p_notes, '')), ''),
    status = 'under_review',
    evaluator_id = null,
    evaluator_remarks = null,
    reviewed_at = null
  where id = p_submission_id returning * into v_submission;

  insert into notifications (recipient_id, type, title, message, related_submission_id)
  select p.id, 'submission_received', 'Compliance submission received',
         'A barangay compliance submission is ready for review.', v_submission.id
  from profiles p where p.role = 'super_admin' and p.is_active = true;
  perform log_audit_event(auth.uid(), 'SUBMIT', 'submissions', v_submission.id, '{}'::jsonb);
  return v_submission;
end;
$function$;


CREATE OR REPLACE FUNCTION app_private.mfa_access_allowed()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare account public.profiles; policy app_private.mfa_policy; reset app_private.mfa_resets; claims jsonb := auth.jwt();
begin
  if claims->>'role' = 'service_role' then return true; end if;
  -- Trusted SQL maintenance/cron only; PostgREST sessions use authenticator.
  if auth.uid() is null and session_user in ('postgres','supabase_admin') and coalesce(claims,'{}'::jsonb)='{}'::jsonb then return true; end if;
  if auth.uid() is null then return false; end if;
  if not exists(select 1 from auth.sessions where id=(claims->>'session_id')::uuid and user_id=auth.uid()) then return false; end if;
  select * into account from public.profiles where id=auth.uid();
  if account.id is null or not account.is_active then return false; end if;
  if account.role::text not in ('super_admin','barangay_secretary') then return false; end if;
  select * into reset from app_private.mfa_resets where user_id=auth.uid();
  if reset.blocked or reset.access_removed_at is not null then return false; end if;
  if (claims->>'session_id')::uuid = any(reset.revoked_session_ids) then return false; end if;
  if reset.tokens_valid_after > '-infinity'::timestamptz then
    if to_timestamp(coalesce((claims->>'iat')::bigint,0)) < reset.tokens_valid_after then return false; end if;
    -- A refreshed old password session cannot bypass a lost-device reset.
    if not exists(select 1 from jsonb_array_elements(coalesce(claims->'amr','[]'::jsonb)) a
      where a->>'method'='totp' and to_timestamp(coalesce((a->>'timestamp')::bigint,0)) >= reset.tokens_valid_after)
    then return false; end if;
  end if;
  select * into policy from app_private.mfa_policy where singleton;
  if not policy.enabled then return true; end if;
  if account.role::text = any(policy.required_roles) then
    return coalesce(claims->>'aal','aal1')='aal2'
      and exists(select 1 from jsonb_array_elements(coalesce(claims->'amr','[]'::jsonb)) a where a->>'method'='totp')
      and exists(
      select 1 from auth.mfa_factors where user_id=auth.uid() and factor_type='totp' and status='verified');
  end if;
  return true;
end $function$;


CREATE OR REPLACE FUNCTION app_private.complete_user_invitation(p_actor_id uuid, p_user_id uuid, p_full_name text, p_email text, p_role text, p_barangay_id uuid, p_restore_existing boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.profiles; restored boolean;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active) then
    raise exception 'Active Super Administrator required' using errcode='42501';
  end if;
  if p_user_id=p_actor_id then raise exception 'You cannot invite or change your own account'; end if;
  if p_role is null or p_role <> 'super_admin'
    or p_full_name is null or length(trim(p_full_name)) not between 1 and 200
    or p_email is null or length(trim(p_email)) not between 3 and 254 then
    raise exception 'A name, email and Super Administrator role are required';
  end if;
  if p_barangay_id is not null then
    raise exception 'Administrator accounts cannot be assigned a barangay';
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
end $function$;


-- Historical hosted and local installations used different names.
DO $review_policy$
DECLARE legacy_name text; policies_found integer := 0;
BEGIN
  FOR legacy_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='submissions'
      AND policyname IN ('submissions_huc_administrator_update','submissions_huc_director_update')
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.submissions USING (public.current_role_name() = ''super_admin''::public.user_role)',legacy_name);
    policies_found := policies_found+1;
  END LOOP;
  IF policies_found=0 THEN RAISE EXCEPTION 'Expected review authorization policy is missing'; END IF;
END;
$review_policy$;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_director_role_retired
CHECK (role <> 'huc_director'::public.user_role);
UPDATE app_private.mfa_policy SET required_roles=array_remove(required_roles,'huc_director');

INSERT INTO public.audit_logs(action,entity_table,metadata)
VALUES ('HUC_DIRECTOR_ROLE_RETIRED','profiles',jsonb_build_object('active_application_roles',array['super_admin','barangay_secretary'],'existing_director_accounts',0,'notifications_routed_to','super_admin'));
NOTIFY pgrst,'reload schema';
