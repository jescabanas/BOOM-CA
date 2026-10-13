-- Preparation stage. Activate only after Auth TOTP and the new frontend are ready.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;

create table app_private.mfa_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  required_roles text[] not null default array['super_admin','huc_director','barangay_secretary']
);
insert into app_private.mfa_policy(singleton) values(true);
create table app_private.mfa_resets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked boolean not null default false,
  tokens_valid_after timestamptz not null default '-infinity',
  operation_id uuid,
  started_at timestamptz
);
alter table app_private.mfa_policy enable row level security;
alter table app_private.mfa_resets enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
grant all on all tables in schema app_private to service_role;

create function app_private.mfa_access_allowed() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare account public.profiles; policy app_private.mfa_policy; reset app_private.mfa_resets; claims jsonb := auth.jwt();
begin
  if claims->>'role' = 'service_role' then return true; end if;
  -- Trusted SQL maintenance/cron only; PostgREST sessions use authenticator.
  if auth.uid() is null and session_user in ('postgres','supabase_admin') and coalesce(claims,'{}'::jsonb)='{}'::jsonb then return true; end if;
  if auth.uid() is null then return false; end if;
  if not exists(select 1 from auth.sessions where id=(claims->>'session_id')::uuid and user_id=auth.uid()) then return false; end if;
  select * into account from public.profiles where id=auth.uid();
  if account.id is null or not account.is_active then return false; end if;
  if account.role::text not in ('super_admin','huc_director','barangay_secretary') then return false; end if;
  select * into reset from app_private.mfa_resets where user_id=auth.uid();
  if reset.blocked then return false; end if;
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
end $$;
revoke all on function app_private.mfa_access_allowed() from public, anon;
grant execute on function app_private.mfa_access_allowed() to authenticated, service_role;

create function app_private.mfa_bootstrap() returns jsonb
language sql stable security definer set search_path = '' as $$
select jsonb_build_object('id',p.id,'role',p.role,'is_active',p.is_active,
 'mfa_required',p.role::text=any(c.required_roles),
 'access_allowed',app_private.mfa_access_allowed(),'blocked',coalesce(r.blocked,false))
from public.profiles p cross join app_private.mfa_policy c
left join app_private.mfa_resets r on r.user_id=p.id where p.id=auth.uid() and c.singleton;
$$;
revoke all on function app_private.mfa_bootstrap() from public, anon;
grant execute on function app_private.mfa_bootstrap() to authenticated;
create function public.mfa_bootstrap() returns jsonb language sql stable security invoker set search_path=''
as $$ select app_private.mfa_bootstrap() $$;
revoke all on function public.mfa_bootstrap() from public, anon;
grant execute on function public.mfa_bootstrap() to authenticated;

create function app_private.require_mfa() returns void
language plpgsql security definer set search_path='' as $$
begin
 if not app_private.mfa_access_allowed() then raise exception 'MFA verification and an active account are required' using errcode='42501'; end if;
end $$;
revoke all on function app_private.require_mfa() from public, anon, authenticated;

-- RESTRICTIVE policies AND with the existing ownership/role policies.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table public.%I enable row level security',t.tablename);
  execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select app_private.mfa_access_allowed())) with check ((select app_private.mfa_access_allowed()))',t.tablename);
 end loop;
end $$;
create policy mfa_required on storage.objects as restrictive for all to authenticated
using ((select app_private.mfa_access_allowed())) with check ((select app_private.mfa_access_allowed()));

-- Non-public views must honor the underlying RLS. Materialized results cannot
-- enforce per-request RLS; they are server-only instead.
do $$ declare v record; begin
 for v in select viewname from pg_views where schemaname='public' loop
  execute format('alter view public.%I set (security_invoker=true)',v.viewname);
  execute format('revoke all on public.%I from public, anon',v.viewname);
 end loop;
 for v in select matviewname from pg_matviews where schemaname='public' loop
  execute format('revoke all on public.%I from public, anon, authenticated',v.matviewname);
 end loop;
end $$;

-- Clone the existing implementations into a non-exposed schema and keep their
-- signatures/defaults/role checks intact behind an explicit MFA guard.
-- Do not ALTER FUNCTION ... SET SCHEMA: existing view dependencies would follow
-- the old OID and bypass the new public wrapper.
do $$
declare f record; definition text; arguments text; call_args text; result text; body text;
begin
 for f in select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array[
 'log_audit_event','recalculate_all_scores','refresh_barangay_performance_mv','calculate_submission_score',
 'create_compliance_submission','submit_compliance_submission','review_compliance_submission','remove_mandate_safely',
 'leaderboard_for_period','mandate_compliance_for_period','generate_ranking_snapshot','barangays_compliant_for_mandate',
 'leaderboard_for_compliance_period','analytics_period_rankings','analytics_period_mandates',
 'analytics_period_barangays_for_mandate','ensure_compliance_schedule_periods']) loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(', 'FUNCTION app_private.'||f.proname||'(');
  execute definition;
  execute format('alter function app_private.%I(%s) set search_path=public,pg_temp',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('revoke all on function app_private.%I(%s) from public, anon, authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  arguments:=pg_get_function_arguments(f.oid); result:=pg_get_function_result(f.oid);
  select string_agg(format('$%s',i),',') into call_args from generate_series(1,f.pronargs) i;
  body:='begin perform app_private.require_mfa(); ';
  if f.proname=any(array['recalculate_all_scores','refresh_barangay_performance_mv','generate_ranking_snapshot','remove_mandate_safely']) then
   body:=body||'if coalesce(auth.jwt()->>''role'','''') <> ''service_role'' and public.current_role_name()::text <> ''super_admin'' then raise exception ''Super Administrator required'' using errcode=''42501''; end if; ';
  end if;
  if f.proname='calculate_submission_score' then
   body:=body||'if coalesce(auth.jwt()->>''role'','''') <> ''service_role'' and not public.is_staff() then raise exception ''Staff required'' using errcode=''42501''; end if; ';
  end if;
  if f.proname='log_audit_event' then
   body:=body||'if coalesce(auth.jwt()->>''role'','''') <> ''service_role'' and $1 is distinct from auth.uid() then raise exception ''Cannot impersonate audit actor'' using errcode=''42501''; end if; ';
  end if;
  if f.proretset then body:=body||format('return query select * from app_private.%I(%s); ',f.proname,coalesce(call_args,''));
  elsif result='void' then body:=body||format('perform app_private.%I(%s); return; ',f.proname,coalesce(call_args,''));
  else body:=body||format('return app_private.%I(%s); ',f.proname,coalesce(call_args,'')); end if;
  execute format('create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path=public,pg_temp as %L',f.proname,arguments,result,body||'end');
  execute format('revoke all on function public.%I(%s) from public, anon',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.%I(%s) to authenticated, service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
 -- Scheduled/trigger helpers are not browser RPCs.
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.prorettype in ('trigger'::regtype,'event_trigger'::regtype)
 or p.proname=any(array['notify_upcoming_deadlines','notify_user','seed_compliance_calendar'])) loop
  execute format('revoke all on function public.%I(%s) from public, anon, authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('alter function public.%I(%s) set search_path=public,pg_temp',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end $$;

alter function public.current_role_name() set search_path=public,pg_temp;
alter function public.current_barangay_id() set search_path=public,pg_temp;
alter function public.is_staff() set search_path=public,pg_temp;

-- Public exception: only published barangay names/ranks, not submission dates,
-- statuses, profile details or proofs. Uses the isolated aggregate implementation.
create function public.public_barangay_rankings(p_year integer,p_month integer)
returns table(barangay_name text,current_rank bigint)
language sql stable security definer set search_path='' as $$
 select r.barangay_name,r.current_rank from app_private.leaderboard_for_compliance_period(null,p_year,p_month) r
 where p_year between 2026 and 2100 and p_month between 1 and 12;
$$;
revoke all on function public.public_barangay_rankings(integer,integer) from public;
grant execute on function public.public_barangay_rankings(integer,integer) to anon,authenticated,service_role;

-- Retired email OTP tables are not a second MFA authority.
do $$ begin if to_regclass('public.email_mfa_challenges') is not null then
 revoke all on public.email_mfa_challenges from public,anon,authenticated;
end if; end $$;

-- Service-only reset ledger; only the verified Edge Function can supply the actor.
create function public.begin_mfa_reset(p_user_id uuid,p_actor_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare op uuid:=gen_random_uuid();
begin
 if p_user_id=p_actor_id or p_reason is null or length(trim(p_reason)) not between 10 and 1000 or not exists(select 1 from public.profiles where id=p_actor_id and role='super_admin' and is_active)
 then raise exception 'Verified administrator and identity-check reason required'; end if;
 if not exists(select 1 from public.profiles where id=p_user_id and is_active) then raise exception 'Active target account required'; end if;
 insert into app_private.mfa_resets(user_id) values(p_user_id) on conflict do nothing;
 perform 1 from app_private.mfa_resets where user_id=p_user_id for update;
 if exists(select 1 from app_private.mfa_resets where user_id=p_user_id and blocked and started_at>now()-interval '5 minutes')
 then raise exception 'Reset already in progress; retry after five minutes'; end if;
 update app_private.mfa_resets set blocked=true,tokens_valid_after=date_trunc('second',now())+interval '1 second',operation_id=op,started_at=now() where user_id=p_user_id;
 insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata) values(p_actor_id,'MFA_RESET_STARTED','profiles',p_user_id,jsonb_build_object('reason',p_reason,'operation_id',op));
 return op;
end $$;
create function public.complete_mfa_reset(p_user_id uuid,p_actor_id uuid,p_operation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.mfa_factors where user_id=p_user_id) then raise exception 'Factors still remain; reset stays blocked'; end if;
 update app_private.mfa_resets set blocked=false where user_id=p_user_id and operation_id=p_operation_id and blocked;
 if not found then raise exception 'Reset operation changed'; end if;
 insert into public.audit_logs(user_id,action,entity_table,entity_id,metadata) values(p_actor_id,'MFA_RESET_COMPLETED','profiles',p_user_id,jsonb_build_object('operation_id',p_operation_id));
end $$;
revoke all on function public.begin_mfa_reset(uuid,uuid,text),public.complete_mfa_reset(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_mfa_reset(uuid,uuid,text),public.complete_mfa_reset(uuid,uuid,uuid) to service_role;
