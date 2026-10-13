-- Service-only counters: one email per recipient per minute, 200 per hour overall.
create table app_private.auth_email_attempts (
  key text primary key,
  window_started timestamptz not null,
  attempts integer not null
);
alter table app_private.auth_email_attempts enable row level security;
revoke all on app_private.auth_email_attempts from public, anon, authenticated;
create or replace function public.consume_auth_email_attempt(p_email text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare count integer; recipient text;
begin
  recipient := md5(lower(trim(p_email)));
  insert into app_private.auth_email_attempts values('global',now(),1)
  on conflict(key) do update set
    attempts=case when auth_email_attempts.window_started < now()-interval '1 hour' then 1 else auth_email_attempts.attempts+1 end,
    window_started=case when auth_email_attempts.window_started < now()-interval '1 hour' then now() else auth_email_attempts.window_started end
  returning attempts into count;
  if count > 200 then return false; end if;
  insert into app_private.auth_email_attempts values(recipient,now(),1)
  on conflict(key) do update set
    attempts=case when auth_email_attempts.window_started < now()-interval '1 minute' then 1 else auth_email_attempts.attempts+1 end,
    window_started=case when auth_email_attempts.window_started < now()-interval '1 minute' then now() else auth_email_attempts.window_started end
  returning attempts into count;
  delete from app_private.auth_email_attempts where window_started < now()-interval '1 day';
  return count <= 1;
end;
$$;
revoke all on function public.consume_auth_email_attempt(text) from public,anon,authenticated;
grant execute on function public.consume_auth_email_attempt(text) to service_role;
