# Account applications

The public sign-in page now offers **Apply for Account**, below Sign in. The applicant submits:
- Full name and an email they can access
- An active Lucena City barangay
- Appointment letter, authentication of office, and PDS (Personal Data Sheet), all required (PDF, PNG or JPG; at most 10 MB per file)
- Consent to verification

The request is not an Auth account. No password is collected. Open **Admin Console → Account Applications** to search/filter requests and preview each of the three private documents beside the applicant details. Older requests remain readable; missing documents on those records are labeled as unavailable.

## Decisions

**Approve & create account** assigns the fixed `barangay_secretary` role and the requested barangay. It creates the profile and approval record transactionally, then sends a password-setup recovery email to the applicant. They set their own password on `reset-password.html` and subsequently sign in.

**Deny application** requires a reason, saves the decision, and creates no account. Denial reasons are administrator-only; denial does not currently send an email. Contact the applicant separately if needed.

Approved requests offer **Resend setup email**. If email delivery fails, the account remains approved and the UI reports the failure; retry does not create a second account.

Existing manually provisioned accounts and staff-account tools remain intact.

## Returning secretaries

A secretary whose access was removed can use **Apply for Account** with their
original email, requested barangay and three current verification documents.
Submitting the request does not reactivate the account. Previous approved
applications and all submitted work remain in the system.

In **Account Applications**, review their documents and choose **Approve &
restore account**. This reuses the original authentication/profile ID, clears
the removal block, preserves file authorship, submission history and their
authenticator, and requires a fresh sign-in. The action is audited. **Deny
application** keeps the original account removed.

If the barangay already has an active secretary, approval restores the account
as an inactive successor. Use **Barangay Access → Assign replacement** for the
handover; approval does not remove the incumbent. The setup email can be resent
after a delivery failure. Existing active accounts or administrator/director
accounts cannot be changed into secretaries through this application workflow.

Deploy `20261007075726_secretary_application_restoration.sql`, both application
Edge Functions and the updated frontend together. The account lookup and
finalization helper are service-only; reviewed application access still
requires active Super Administrator MFA. New User remains restricted to Super
Administrator invitations.

## Deployment

Migration: `20261003112855_account_applications.sql`.
Follow-up migration: `20261003121452_account_application_auth_validation.sql` (checks Auth identities through the API, without granting SQL access to Auth records).
Required-document migration: `20261006133805_required_evidence_and_application_documents.sql` (requires `20261005150552_submission_document_revisions.sql`). Deploy the updated `submit-account-application` function and frontend together after applying the migration. New applications must contain all three files; existing applications keep their original records.
Edge Functions: `submit-account-application` and `review-account-application`, both with `verify_jwt=true`.
Shared code: `_shared/account-applications.ts`; Supabase JS is pinned to 2.49.8.

The public function accepts the existing public anon JWT for requesting the barangay list or submitting an application. The review function independently verifies the user with Auth and requires an active Super Administrator profile.

Only server code writes request records and uploads proof. Applicants and Secretaries cannot read the queue or private documents, or approve/deny requests. Admins can read them but cannot directly write decisions via the Data API. The service key is never sent to the browser.

Default password-setup redirects:
- `https://dilgtest2.netlify.app/reset-password.html`
- `http://localhost:5500/DILGtest2/frontend/reset-password.html`
- `http://127.0.0.1:5500/DILGtest2/frontend/reset-password.html`
- `http://localhost:8888/reset-password.html`

Set the server secret `ACCOUNT_APPLICATION_REDIRECT_URLS` to a comma-separated exact allowlist if these paths change. Also add those exact URLs to Supabase **Authentication → URL Configuration → Redirect URLs**; otherwise Supabase may fall back to Sign in. The existing recovery email template configuration is independent of this feature. See `PASSWORD_RECOVERY_SETUP.md`.

Frontend changes are local and work with Live Server; the new backend is connected to the existing project. Upload/deploy the changed frontend when publishing to Netlify.

## Safety and limits

- Proof files are in the private `account-application-proofs` bucket.
- Signed preview URLs expire after five minutes; reopen the review to renew.
- Server validation checks content signatures, not only extensions.
- Request bodies are bounded; uploads never replace existing files.
- One non-denied request per normalized email; duplicate and existing-account requests receive the same generic public receipt.
- Atomic request limits: 3 attempts per email/day, 30/hour globally and 100/day globally. These ceilings can limit bulk onboarding.
- Approval claiming prevents concurrent creation; failed provisioning can be retried.
- Only a new orphan upload/account created within a failed request is eligible for rollback cleanup; existing accounts are never overwritten or removed.
- There is no automatic deletion/retention schedule for proof documents. Set an institution-approved retention policy before handling real identity documents.
- These are baseline abuse controls, not a CAPTCHA. Before broad public rollout, add CAPTCHA and production monitoring, and review the privacy/retention notice with the institution.

## Verification

Fixture-only tests do not send emails or create remote accounts:
```
node --test tests/account-applications.test.cjs
node tests/account-applications.browser.cjs
```

Read-only live smoke checks:
```
node tests/account-applications.live.cjs
```

SQL permissions test: `supabase/tests/account_application_permissions.sql`. It inserts a synthetic request inside a transaction that is explicitly rolled back; no account or file is created.
SQL workflow test: `supabase/tests/account_application_workflow.sql`. It tests service-role profile creation, approval, auditing and rate limits inside an explicitly rolled-back transaction. All synthetic rows are discarded and no email is sent.
