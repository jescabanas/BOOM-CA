# Smart Governance Platform
### Web-Based Automated Scoring and Ranking System for Barangay Performance Evaluation
Prepared for the Department of the Interior and Local Government (DILG)

Replaces manual, Messenger-based MOV (Means of Verification) submission with a
centralized, auditable web platform that automatically scores and ranks all
barangays against DILG governance mandates using the official **5-3-0 timestamp
rule**.

---

## 1. Tech Stack

| Layer      | Technology |
|------------|------------|
| Backend    | Supabase (PostgreSQL, Auth, Storage, Edge Functions, RLS, Cron) |
| Frontend   | HTML5 / CSS3 / vanilla JavaScript (ES2023) |
| Charts     | Chart.js |
| Exports    | SheetJS (CSV/Excel), jsPDF + autotable (PDF) |
| Hosting    | Netlify |

All scoring, ranking, permission enforcement, validation, and audit logging
run **on the backend** (Postgres functions/triggers + Edge Functions guarded
by role checks) — the frontend never computes or trusts a score itself.

## 2. Repository Structure

```
supabase/
  migrations/          -- numbered SQL migrations (schema, RLS, functions, views, seed, storage)
  functions/           -- Deno Edge Functions (score-submission, generate-report, notify, create-user)
  config.toml          -- Supabase CLI project config
frontend/
  index.html           -- login
  dashboard.html        -- Super Administrator dashboard
  admin.html            -- Super Admin console
  evaluator.html         -- Super Administrator review queue
  secretary.html         -- Barangay Secretary submission portal
  public-leaderboard.html -- public, no-login leaderboard
  css/styles.css        -- design system
  js/                   -- shared modules (auth, layout, charts, export, supabaseClient)
  generate-env.sh        -- injects Supabase config at Netlify build time
netlify.toml
.env.example
docs/
  ARCHITECTURE.md
  DATABASE_ERD.md
  API_DOCUMENTATION.md
  USER_MANUAL.md
  ADMINISTRATOR_MANUAL.md
  DEVELOPER_GUIDE.md
  DEPLOYMENT_GUIDE.md
  TESTING_GUIDE.md
  BACKUP_GUIDE.md
```

## 3. Roles

| Role | Landing page | Summary |
|---|---|---|
| Super Administrator | `admin.html` | Full system control: users, barangays, mandates, deadlines, settings, audit log |
| Barangay Secretary | `secretary.html` | Uploads MOV, tracks own submission status and score |
| Public User | `public-leaderboard.html` | Read-only official leaderboard, no login required |

Accounts are provisioned only by a Super Admin (self-signup is disabled) —
see `docs/ADMINISTRATOR_MANUAL.md`.

## 4. The 5-3-0 Scoring Rule

Computed automatically in Postgres (`calculate_submission_score`, see
`supabase/migrations/0003_functions_triggers.sql`) from the submission's
recorded timestamp against the mandate period's deadline and grace period:

| Condition | Points |
|---|---|
| Submitted before deadline | 5 (or the mandate's configured `max_points`) |
| Submitted within grace period | 3 |
| Submitted after grace period (late) | 0 |
| Rejected by evaluator | 0 |
| Missing / never submitted | 0 |

Scores recalculate automatically on every relevant insert/update via database
triggers, and can be bulk-recalculated by a Super Admin after a deadline
change (`recalculate_all_scores()`), or nightly via `pg_cron`.

## 5. Quick Start

See `docs/DEPLOYMENT_GUIDE.md` for full step-by-step instructions. Short version:

```bash
# 1. Create a Supabase project, then link it
supabase link --project-ref YOUR_PROJECT_REF

# 2. Push the schema
supabase db push

# 3. Deploy Edge Functions
supabase functions deploy score-submission generate-report notify create-user

# 4. Set Netlify env vars (SUPABASE_URL, SUPABASE_ANON_KEY) and deploy /frontend
netlify deploy --prod
```

## 6. Documentation Index

- **Architecture** — `docs/ARCHITECTURE.md`
- **Database ERD** — `docs/DATABASE_ERD.md`
- **API / RPC reference** — `docs/API_DOCUMENTATION.md`
- **User Manual** (Secretary/Administrator/Public) — `docs/USER_MANUAL.md`
- **Administrator Manual** — `docs/ADMINISTRATOR_MANUAL.md`
- **Developer Guide** — `docs/DEVELOPER_GUIDE.md`
- **Deployment Guide** — `docs/DEPLOYMENT_GUIDE.md`
- **Testing Guide** — `docs/TESTING_GUIDE.md`
- **Backup & Restore Guide** — `docs/BACKUP_GUIDE.md`

## 7. Known Scope Notes (read before production go-live)

- **Virus scanning** on uploaded MOV files is a placeholder column
  (`documents.scan_status`) — wire it to an actual scanning service (e.g. an
  Edge Function calling ClamAV/VirusTotal) before accepting public uploads at scale.
- **Seed data** ships 33 placeholder barangays (`Barangay 1`...`Barangay 33`) —
  rename them via the Admin Console before go-live.
- **Email delivery** (invites, deadline reminders) requires configuring
  Supabase Auth SMTP settings and, optionally, the `EMAIL_WEBHOOK_URL` secret
  for the `notify` function.
- **MFA** is supported by Supabase Auth but not yet enabled by default in the
  login flow — see `docs/ADMINISTRATOR_MANUAL.md` for how to turn it on.
