# Secretary handover

Open **Admin Console → Barangay Access** as a Super Administrator with verified
MFA. The tab shows each secretary's name, email, barangay and access status.

For a new appointment:

1. Have the replacement apply with their own email and the three mandatory
   documents. Review and approve the application in Account Applications.
2. Choose **Assign replacement**, select the barangay and approved replacement
   account, and enter the reason for the handover.
3. The old secretary loses access and the replacement becomes the current
   secretary in one database transaction. A successor approved while another
   secretary is active waits without dashboard access until this assignment.

In **Admin Console → Users**, **Remove** revokes system access without deleting the account's profile, files,
submissions, original authorship, review history or scores. The replacement uses
the same barangay's records. Removed accounts disappear from Users and Barangay
Access. A Super Administrator can explicitly restore them through **New User**
using the original email, **Super Administrator** role and
**Restore removed or disabled account**. Restoration preserves history and
requires a fresh sign-in. New User cannot restore Barangay Secretary access.
The Users tab replaces Edit with Remove for other accounts, including directors
and administrators. You cannot remove your own account. Removal requires a
reason and verified Super Administrator MFA and is recorded in the Audit Log.
Removed accounts cannot be selected directly as replacement secretaries.
Secretary appointments continue through Account Applications and Barangay
Access. Inactive approved successors awaiting
handover remain eligible. Barangay Access contains Change password and Assign
replacement with matching button dimensions; removal is available only in Users.

For a returning removed secretary, have them apply using the original email and
three current documents. Review the new request in Account Applications and
choose **Approve & restore account**. The original identity, files and history
are retained. If an incumbent is still active, the restored account waits for
**Assign replacement** in Barangay Access. Otherwise it gains secretary access
after a fresh sign-in and authenticator verification. Denial leaves it removed.

**Change password** lets the administrator set a new 12–128 character password
for an active secretary. Confirm both password entries and record the reason.
The console does not retrieve existing passwords, store new passwords, print
them in logs, or put them in audit metadata. The secretary signs in with the new
password and verifies their own existing authenticator. For a lost authenticator,
use the existing Reset authenticator control in Users after checking identity.

All current session IDs are recorded as revoked on removal, reassignment or
password changes. The shared MFA/RLS gate denies those sessions permanently,
including after a token refresh or a later account reactivation. A new sign-in
and fresh MFA verification are required. Direct user status/role/assignment
edits also invalidate the affected secretary's sessions. Existing authenticated
sessions cannot become valid for a successor simply because their account was
activated.

Password changes block protected access before calling Supabase Auth. If the
provider update or completion fails, the account remains blocked. Wait five
minutes and retry Change password, or remove the account's access. A removal
during a password change cannot be undone by its completion.

Access changes and password-operation starts/completions appear in Audit Log.
No account is removed or password changed simply by installing this feature.

## Components and verification

- Migrations: `20261006160607_secretary_access_handover.sql` and
  `20261007030017_system_account_removal.sql` and
  `20261007035811_fair_report_rankings_and_visible_accounts.sql`.
- MFA-protected Edge Function: `change-secretary-password`.
- Frontend: `admin.html` and `js/secretary-access.js`.
- Database/RLS regression: `node --test tests/mfa-database.test.cjs`.
- Password endpoint tests: `node --test tests/secretary-password.test.cjs`.
- Browser checks: `node tests/secretary-access.browser.cjs`.
- Non-writing live endpoint checks: `node tests/secretary-access.live.cjs`.

The migration and password endpoint were deployed to the connected DILGpart2
project on October 7, 2026. The new tab is in the local frontend checkout;
publish that frontend to make it available on the hosted website.

Fixture tests create no remote accounts, send no messages, and change no real
passwords. The SQL tests use isolated PostgreSQL with actual role and RLS checks.
