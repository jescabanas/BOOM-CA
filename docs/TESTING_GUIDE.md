# Testing Guide

## 1. Database / Scoring Unit Tests (pgTAP)

Recommended: [pgTAP](https://pgtap.org/) via `supabase test db`. Example
cases to cover in `supabase/tests/scoring_test.sql` (not included — add per
your team's test framework preference):

```sql
-- On-time submission scores max_points
select is(
  (select points from calculate_submission_score('<submission-id-submitted-before-deadline>')),
  5::numeric
);

-- Grace-period submission scores 3
select is(
  (select band from calculate_submission_score('<submission-id-in-grace>')),
  'grace_period'::score_band
);

-- Late submission scores 0
select is(
  (select points from calculate_submission_score('<submission-id-late>')),
  0::numeric
);

-- Missing submission (never uploaded) scores 0 / band = missing
-- Rejected submission scores 0 regardless of timestamp
```

## 2. Edge Function Tests

For each function, test:
- **Unauthorized** (no JWT) → 401
- **Wrong role** (e.g. secretary calling `create-user`) → 403
- **Happy path** → 200 with expected payload shape
- **Bad input** (missing required field) → 400

Use Deno's built-in test runner (`deno test`) with a mocked `fetch` for
Supabase calls, or run against a local `supabase start` instance for
integration-level coverage.

## 3. RLS / Security Tests

Critical cases — verify these directly against a local Supabase instance
using different JWTs (or `supabase test db` with `set role`):

| Test | Expected |
|---|---|
| Secretary A queries submissions for Barangay B | Empty result (RLS blocks) |
| Secretary attempts to insert a submission for another barangay | Insert rejected |
| Secretary attempts to update a locked submission | Update rejected |
| Public (anon) queries `submissions` table directly | Empty / denied (no public policy on this table) |
| Public queries `v_current_leaderboard` | Succeeds (public view) |
| Evaluator attempts to call `create-user` Edge Function | 403 |
| Non-admin attempts to write `system_settings` | Rejected by RLS |
| Uploaded file MIME type outside the bucket's `allowed_mime_types` | Upload rejected by Storage |

## 4. Integration Tests (end-to-end workflow)

1. Secretary uploads MOV before deadline → submission scores 5, status
   `under_review`.
2. Evaluator approves → Secretary receives `submission_approved`
   notification; `v_current_leaderboard` reflects the new points within the
   next hourly snapshot (or immediately, since the live view isn't
   snapshot-based).
3. Evaluator rejects with remarks → Secretary receives notification with
   the remarks; re-upload is possible if not locked.
4. Deadline passes with no submission → nightly `recalculate_all_scores()`
   marks it `missing` / 0 points.
5. Admin creates a new user → invite email sent, profile row created with
   correct role, audit log entry recorded.

## 5. Black Box / Acceptance Tests (per role)

Each role's manual-testing checklist mirrors `docs/USER_MANUAL.md` — walk
through every numbered step there as a literal test script per role, on a
staging environment, before go-live.

## 6. Load Considerations

- 33 barangays × ~8 mandates × 4 quarters = manageable row counts (low
  thousands per year) — no special partitioning needed.
- The public leaderboard view (`v_current_leaderboard`) is a plain view, not
  materialized, so verify its query plan (`explain analyze`) stays fast as
  data grows; convert to a materialized view refreshed by cron if public
  traffic is high and real-time accuracy isn't required.

## 7. ISO/IEC 25010 Evaluation Checklist

| Characteristic | Evidence in this build |
|---|---|
| **Functional Suitability** | Role-based modules cover all specified workflows (submission, review, scoring, ranking, reporting) |
| **Performance Efficiency** | Materialized views + cron for heavy aggregates; indexes on all FK/status/date columns used in filters |
| **Compatibility** | Standard PostgreSQL + REST via supabase-js; no proprietary lock-in beyond Supabase itself |
| **Usability** | Consistent role-scoped navigation; status pills and plain-language labels throughout |
| **Reliability** | Automated scoring via DB triggers (not client-dependent); audit log for traceability; nightly recalculation catches missed edge cases |
| **Security** | RLS on every table; SECURITY DEFINER-gated writes for audit/score/notification tables; role re-verification in every Edge Function; private storage bucket with signed access |
| **Maintainability** | Numbered, append-only migrations; shared frontend modules (auth/layout/charts/export); documented extension points in Developer Guide |
| **Portability** | Static frontend deployable to any static host; backend is standard Supabase/Postgres, exportable via `pg_dump` |

Use this table as a starting rubric for a formal ISO 25010 evaluation report
— fill in specific test results/metrics per characteristic as you run the
tests above.
