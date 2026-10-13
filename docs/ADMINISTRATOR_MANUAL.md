# Administrator Manual

## 1. Creating Users

Super Administrators can directly invite Super Administrators.
Barangay Secretaries apply through the sign-in page for administrator review.

1. Admin Console → **Users** tab → **+ New User**.
2. Enter full name and email, then choose **Super Administrator**.
3. For a removed or disabled account, use its original email and check
   **Restore removed or disabled account**. Select its new role; previous
   files and history keep their original authorship. Existing authenticators
   are preserved, and old sessions remain revoked.
4. Click **Send invitation**. The recipient receives a DILG setup email to
   choose their own password. Restored accounts can also sign in with their
   existing password and authenticator. The action is recorded in Audit Log.
5. An already active account keeps its role; use **Resend setup email** in
   Users if it needs another invitation. This button also retries failed email
   delivery without creating another account.
6. New User cannot create or restore Barangay Secretary access. Review secretary
   applications in **Account Applications**, then use **Barangay Access** for
   the handover. Returning secretaries reapply with their original email and
   current documents; choose **Approve & restore account** to restore their
   existing account and history.
7. Use **Remove** in Users to revoke access while preserving files and history.
8. When a user loses both their password and authenticator, confirm their identity,
   choose **Reset Authenticator**, and wait for success before using **Resend setup
   email**. The recipient saves a new password, scans and verifies the new QR
   code, returns to sign-in, and signs in with their email, password and code.
   **Check authenticator reset** on an already-open password page refreshes the
   old-factor prompt after the administrator reset completes.

## 2. Managing Barangays

- **Barangays** tab lists all 33 (or however many are configured), their
  cluster, and active status.
- The seed script creates placeholders named `Barangay 1`...`Barangay 33` —
  rename these to the real barangay names and assign correct clusters before
  go-live (via SQL `update barangays set name = '...' where code = '...'`,
  or extend the admin UI with an edit form — see Developer Guide).
- Clusters group barangays for filtering (e.g., districts) — manage via the
  `clusters` table.

## 3. Managing Mandates & Deadlines

- **Mandates** tab lists all governance categories (Road Clearing, Peace and
  Order, etc.) with their max points and status.
- Each mandate has one or more **mandate periods** (per year/quarter) with
  its own `deadline_at` and `grace_period_hours` — this is what the scoring
  engine actually reads. Create a new period each quarter via SQL/Studio or
  extend the admin UI (see Developer Guide) with a form that inserts into
  `mandate_periods`.
- **Recalculate All Scores** button re-runs the 5-3-0 calculation for every
  unlocked submission — use this after extending a deadline or correcting a
  mandate's point value.

## 4. Scoring Rules

Default rule (before deadline = 5, grace period = 3, late = 0) lives in
`system_settings.scoring_rules` and is enforced in
`calculate_submission_score()`. Changing the JSON in `system_settings` alone
does **not** change behavior unless the SQL function is also updated to read
from it — currently the function uses hardcoded 5/3/0 logic per the official
rule. If DILG changes the point scheme, update
`supabase/migrations/0003_functions_triggers.sql` and redeploy the migration
rather than only editing the settings row, so the two never drift out of
sync.

## 5. Audit Log

- **Audit Log** tab shows the last 100 events (login, logout, upload,
  approval, rejection, user creation, role changes, report generation).
- Every row has timestamp, acting user, action, and affected entity.
- Full history is queryable directly in `audit_logs` for compliance requests
  beyond the 100-row UI view.

## 6. Backup & Restore

See `BACKUP_GUIDE.md`. Supabase provides automatic daily backups on paid
tiers; for manual/offsite backups use `supabase db dump`.

## 7. System Settings

`system_settings` table holds platform-wide config (`platform_name`,
`scoring_rules`). Only Super Admins can read/write it (see RLS policy
`settings_admin_all`).
