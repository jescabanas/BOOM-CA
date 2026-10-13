# API Documentation

The platform has no traditional REST controller layer — the frontend talks
directly to Supabase via `supabase-js`, protected by RLS, plus four Edge
Functions for privileged server-side actions.

## 1. Edge Functions

Base URL: `https://YOUR-PROJECT.supabase.co/functions/v1/`

All Edge Function calls must include `Authorization: Bearer <user JWT>`.

### `POST /score-submission`
Recomputes a submission's score on demand (roles: `dilg_evaluator`, `super_admin`).

```json
// Request
{ "submission_id": "uuid" }

// Response 200
{ "success": true, "score": { "points": 5, "band": "on_time" } }
```

### `POST /generate-report`
Server-side CSV export, audit-logged (role: `super_admin`).

```json
// Request
{
  "report_type": "barangay_performance | mandate_compliance | late_submissions | rejected_mov | audit_report",
  "filters": { "limit": 1000 }
}
// Response: text/csv attachment
```

### `POST /notify`
Creates a notification (and optionally sends email if `EMAIL_WEBHOOK_URL` is configured).

```json
{
  "recipient_id": "uuid",
  "type": "deadline_approaching",
  "title": "...",
  "message": "...",
  "submission_id": "uuid | null",
  "send_email": false
}
```

### `POST /create-user`
Provisions a new account (role: `super_admin` only).

```json
{
  "full_name": "Juan Dela Cruz",
  "email": "juan@example.gov.ph",
  "role": "barangay_secretary",
  "barangay_id": "uuid"   // required only when role = barangay_secretary
}
```

## 2. Key Postgres Functions (called via `supabase.rpc(...)`)

| Function | Purpose | Callable by |
|---|---|---|
| `calculate_submission_score(p_submission_id)` | Returns `(points, band)` per the 5-3-0 rule — read-only, no side effects | Any authenticated role (used internally by triggers) |
| `recalculate_all_scores()` | Bulk recompute for every unlocked submission | `super_admin` (via RLS on `submissions` update) |
| `generate_ranking_snapshot(year, quarter)` | Rebuilds `ranking_snapshots` for a period | Run by `pg_cron`; callable manually by admins |
| `refresh_barangay_performance_mv()` | Refreshes the materialized reporting view | `pg_cron` nightly |
| `log_audit_event(...)` | SECURITY DEFINER — the only way to write to `audit_logs` | Called internally by triggers and Edge Functions |
| `notify_user(...)` | SECURITY DEFINER — the only way to write to `notifications` | Called internally by triggers and the `notify` function |

## 3. Views Used Directly by the Frontend

| View | Used on | Notes |
|---|---|---|
| `v_current_leaderboard` | `public-leaderboard.html`, `dashboard.html` | Public-readable, no PII |
| `v_director_dashboard_cards` | `dashboard.html` | Single-row aggregate |
| `v_submission_trends` | `dashboard.html` (line chart) | Monthly rollup |
| `v_mandate_completion` | `dashboard.html` (bar chart) | Per-mandate completion rate |

## 4. Row Level Security Summary

Full policies are in `supabase/migrations/0002_rls_policies.sql`. Summary:

| Resource | Public | Secretary | Administrator |
|---|---|---|---|
| Public rankings RPC | names/ranks | names/ranks | names/ranks |
| Submissions/documents | no private access | assigned barangay | all barangays, including review |
| Analytics | public ranking only | own barangay | all barangays |
| Account management/audit | no | no | authorized management |
| Notifications | no | own | own |

Private access also requires active-account and session checks; MFA enforcement follows the configured database policy. HUC Director is retired by the role-removal migration.

## 5. Storage

Bucket: `mov-documents` (private). Path convention:
`mov-documents/{barangay_id}/{submission_id}/{timestamp}_{filename}`.
Access is governed by storage policies mirroring the table-level RLS (a
secretary can only read/write under their own `barangay_id` folder; staff
roles can read all).
