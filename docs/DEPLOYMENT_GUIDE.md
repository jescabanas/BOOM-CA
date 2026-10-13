# Deployment Guide

> **TOTP rollout:** Before pushing pending migrations or deploying authentication
> changes, follow [TOTP_MFA.md](TOTP_MFA.md). Deploy the MFA-capable frontend and
> gated Edge Functions before the final enforcement migration. The preparation
> migration also changes RPC/view/Storage permissions; coordinate the rollout.

## 1. Create the Supabase Project

For the New User invitation/restoration update on an existing installation,
apply `20261007073525_invite_and_restore_system_accounts.sql` first, deploy the
updated `create-user` Edge Function with its shared dependencies and JWT
verification enabled, then publish the frontend. The helpers are service-only;
the Edge Function verifies administrator role, active access and MFA. No existing
accounts are restored by the migration itself. See ADMINISTRATOR_MANUAL.md for
the New User workflow.

For returning-secretary applications, apply
`20261007075726_secretary_application_restoration.sql`, deploy the updated
`submit-account-application` and `review-account-application` functions with
their shared dependencies, then publish the frontend. This migration does not
restore accounts by itself; a reviewed application must be explicitly approved.

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Note your **Project URL**, **anon public key**, and **service role key**
   (Project Settings → API).
3. Enable the `pg_cron` extension: Database → Extensions → search
   `pg_cron` → Enable.

## 2. Push the Database

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push        # applies all migrations in supabase/migrations/, in order
```

This creates the schema, RLS policies, scoring functions/triggers, views,
seed data (33 placeholder barangays + sample mandates), storage bucket, and
cron jobs.

## 3. Deploy Edge Functions

```bash
supabase functions deploy score-submission
supabase functions deploy generate-report
supabase functions deploy notify
supabase functions deploy create-user

# Set secrets used by the functions
supabase secrets set EMAIL_WEBHOOK_URL=https://your-email-provider-webhook
# Required only for the optional resend-invitation email function. Keep these
# in Supabase Edge Function secrets, never in Netlify or frontend/env.js.
supabase secrets set BREVO_API_KEY=xkeysib_your_government_owned_key
supabase secrets set EMAIL_FROM=no-reply@your-government-domain.gov.ph
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available
to Edge Functions — no need to set them manually.

## 4. Configure Auth

1. Authentication → Providers → Email: keep "Confirm email" **on**.
2. Authentication → URL Configuration: set **Site URL** to your Netlify
   domain, and add the exact `/reset-password.html` URL to **Redirect URLs**.
   See [password recovery setup](PASSWORD_RECOVERY_SETUP.md) for the DILG email
   template, local testing URLs, and hosted configuration instructions.
3. Authentication → Settings: leave **Enable email signups** OFF — accounts
   are created only via the `create-user` Edge Function by a Super Admin.
4. Create your first Super Admin manually (chicken-and-egg — there's no
   admin yet to use the console):
   ```bash
   # Via Supabase Dashboard → Authentication → Users → Invite User
   # Then, in SQL Editor:
   insert into profiles (id, full_name, email, role)
   values ('<the-invited-user-uuid>', 'Your Name', 'you@example.gov.ph', 'super_admin');
   ```

## 5. Deploy the Frontend to Netlify

1. Push this repo to GitHub/GitLab.
2. Netlify → New Site from Git → select the repo.
3. Build settings (already in `netlify.toml`):
   - Base directory: `frontend`
   - Build command: `sh generate-env.sh`
   - Publish directory: `frontend`
4. Site settings → Environment variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   (anon key is safe to expose client-side — RLS is the actual security
   boundary, not key secrecy.)
5. Deploy. `generate-env.sh` runs at build time and writes `env.js` with
   these values baked in.

## 6. Post-Deploy Checklist

- [ ] Sign in as the Super Admin you created in step 4.
- [ ] Rename the 33 placeholder barangays to their real names/clusters.
- [ ] Create Super Administrator accounts for designated DILG custodians and each
      Barangay Secretary.
- [ ] Review/adjust mandate periods and deadlines for the current
      quarter.
- [ ] Confirm the public leaderboard loads at `/public-leaderboard.html`
      without login.
- [ ] Verify cron jobs are running: SQL Editor →
      `select * from cron.job;`
- [ ] Set up Supabase's built-in daily backups (Settings → Database →
      Backups) or your own schedule — see `BACKUP_GUIDE.md`.

## 7. Custom Domain (optional)

Netlify → Domain settings → Add custom domain, then update Supabase Auth's
Site URL and Redirect URLs to match.
