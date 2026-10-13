-- Retires the former Brevo-backed OTP challenge data from existing projects.
-- The email_mfa_challenges table is not used by the application anymore.
drop table if exists public.email_mfa_challenges cascade;
