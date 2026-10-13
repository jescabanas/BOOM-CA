-- Deploy only AFTER Auth TOTP enrollment/verification, MFA-capable frontend,
-- and every protected Edge Function are deployed. See docs/TOTP_MFA.md.
update app_private.mfa_policy set enabled=true where singleton;
