# System Architecture

## 1. High-Level Overview

```
┌─────────────────┐      HTTPS       ┌───────────────────────────────┐
│  Netlify (CDN)   │ ───────────────▶ │  Static Frontend (HTML/CSS/JS)│
│  frontend/*.html │                  └───────────────────────────────┘
└─────────────────┘                                │
                                                     │ supabase-js (anon key)
                                                     ▼
                                    ┌────────────────────────────────────┐
                                    │            Supabase                │
                                    │  ┌──────────────┐  ┌─────────────┐ │
                                    │  │  Auth (JWT)  │  │   Storage   │ │
                                    │  └──────────────┘  └─────────────┘ │
                                    │  ┌──────────────────────────────┐  │
                                    │  │  PostgreSQL                  │  │
                                    │  │  - RLS policies               │  │
                                    │  │  - Triggers (scoring, notify) │  │
                                    │  │  - Views / Materialized views │  │
                                    │  │  - pg_cron scheduled jobs     │  │
                                    │  └──────────────────────────────┘  │
                                    │  ┌──────────────────────────────┐  │
                                    │  │  Edge Functions (Deno)        │  │
                                    │  │  - score-submission            │  │
                                    │  │  - generate-report             │  │
                                    │  │  - notify                      │  │
                                    │  │  - create-user                 │  │
                                    │  └──────────────────────────────┘  │
                                    └────────────────────────────────────┘
```

## 2. Design Principles

1. **Backend is the source of truth.** Scoring, ranking, and validation all
   happen in PostgreSQL functions/triggers or in Edge Functions that re-check
   the caller's role — never in client-side JavaScript. The frontend only
   *displays* what the backend computed.
2. **RLS as the permission boundary.** Every table has Row Level Security
   enabled; policies encode the same role matrix described in the project
   brief (Super Admin / Barangay Secretary /
   Public). Client code cannot bypass this by crafting a different query.
3. **SECURITY DEFINER for controlled writes.** Tables like `audit_logs` and
   `scores` have no client-facing INSERT policy at all — the only way to
   write to them is through a `SECURITY DEFINER` function
   (`log_audit_event`, `apply_submission_score`) that the frontend cannot
   circumvent.
4. **Defense in depth on Edge Functions.** Even though RLS already blocks
   unauthorized data access, Edge Functions that perform privileged actions
   (creating users, forcing a rescore) independently re-verify the caller's
   role before touching the service-role client.
5. **Immutable audit trail.** Every login, upload, approval, rejection, role
   change, and configuration change is logged with timestamp, user, IP
   (captured by Supabase Auth), and affected record.

## 3. Data Flow: Submission → Score → Ranking

1. Barangay Secretary uploads a file → `documents` insert.
2. `trg_document_upload` trigger stamps `submissions.submitted_at` (first
   upload only) and flips status to `under_review`.
3. `trg_score_on_submission` trigger (fires on `submitted_at`/`status`
   changes) calls `calculate_submission_score()`, which compares
   `submitted_at` against the mandate period's `deadline_at` +
   `grace_period_hours` and returns points + band.
4. The result is written to `submissions.points_awarded` /
   `score_band` and appended to the `scores` history table.
5. DILG Evaluator reviews the MOV and sets `status` to `approved` /
   `rejected` / `correction_requested`; `trg_submission_review` notifies the
   Secretary and logs the decision.
6. `generate_ranking_snapshot()` (run hourly by `pg_cron`, or on demand)
   aggregates all submissions per barangay into `ranking_snapshots`, which
   powers both the live `v_current_leaderboard` view and historical
   snapshots.

## 4. Authentication & Session Model

- Supabase Auth issues short-lived JWTs (1 hour, auto-refreshed by
  `supabase-js`).
- `profiles.role` is the single source of truth for authorization; the JWT
  itself only proves identity, not role — every RLS policy and Edge
  Function looks up `profiles.role` fresh rather than trusting a claim.
- Self-signup is disabled (`enable_signup = false` in `config.toml`);
  accounts are created only through the `create-user` Edge Function by a
  Super Admin, which uses `auth.admin.inviteUserByEmail` so no plaintext
  password ever passes through the application.

## 5. Why Materialized Views + Cron

`ranking_snapshots` and `mv_barangay_performance` exist because reporting
queries (quarterly comparisons, historical trend charts) are read-heavy and
don't need to reflect a submission that happened 30 seconds ago. Live pages
(the public leaderboard, director cards) read from lightweight regular views
(`v_current_leaderboard`, `v_director_dashboard_cards`) that stay accurate in
real time; heavier historical rollups are precomputed on a schedule to keep
the interactive dashboard fast under load from all 33 barangays plus DILG
staff.
