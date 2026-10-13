# Supabase TOTP MFA

## Implementation and current rollout status

The site is static HTML/JavaScript (no framework or custom session server), using Supabase JS **2.49.8**, Supabase Auth, PostgreSQL RLS/RPCs, Storage and Edge Functions. Required roles: **Super Administrator (`super_admin`), Barangay Secretary (`barangay_secretary`)**.

The local implementation and isolated tests are complete. **The preparation migration is now applied to the hosted project, but final enforcement is OFF and the server-function rollout is incomplete.** After explicit user approval for project-wide permissions and a maintenance window, the migration was accepted. Hosted TOTP enrollment/verification is enabled (10 factors). Local `config.toml` does not configure hosted Auth by itself. No Netlify deployment was authorized or performed.

The new local sign-in and protected pages use `mfa_bootstrap` and the provider assurance level. The preparation RPC is available and the user has successfully tested TOTP through Live Server. The browser flow must not be confused with complete server/database enforcement: the final activation migration remains unapplied.

### 4 October deployment checkpoint

The user selected **Live Server only**, with no Netlify deployment. The database-only restore rehearsal passed (52 exported table counts and 189 original backup hashes), and all 14 MFA tests passed again. Custom email-secret values are unavailable; their existing hosted values remain unchanged. Initial migration attempts were rejected; after the user explicitly approved the database/view/RPC/Storage permission changes and related function rollout, preparation was applied successfully.

Verified hosted state: `mfa_bootstrap` available, authenticated execution allowed and anonymous execution denied; all 20 public base tables and `storage.objects` have restrictive MFA policies; no public view lacks `security_invoker`; reset-ledger RPC is service-only; `app_private.mfa_policy.enabled = false`. The user reported working TOTP, and a read-only check confirmed **one active Super Administrator with a verified TOTP factor**. There are three active Super Administrator accounts; at least two independently controlled authenticators must be verified before activation.

Successfully deployed with JWT verification enabled: `score-submission` version 7, `generate-report` version 7, `reset-user-mfa` version 1. `create-user` and `resend-user-invite` updates were rejected because of Netlify redirects/Brevo delivery; `notify` was rejected because it forwards email/message contents to an unverified webhook. Do not rerun these rejected deployments through another tool unchanged. Resolve the destination scope/authorization or obtain approval for a safe alternate delivery design before retrying review. After the turn was interrupted, a fresh function inventory confirmed `review-account-application` remains version 2, `submit-account-application` remains version 1, and all three old email-MFA functions remain at their pre-rollout versions. Their updates/retirement are still pending. **Do not activate global enforcement while these protected API gaps remain.**

Security advisors still report intentional privileged public wrappers and the limited anonymous rankings RPC, anonymous own-account helpers, private RLS-enabled tables without client policies (intentional deny-all), and existing Auth password/email-OTP warnings. This is not a clean-advisor/full-security-audit claim. Advisor explanations: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.

## Modules

| Responsibility | File |
| --- | --- |
| Provider MFA calls; safe replacement | `frontend/js/mfa-service.js` |
| QR/manual enrollment, six-digit verification, errors/retry | `frontend/js/mfa-ui.js`, `frontend/mfa.html`, `frontend/css/mfa.css` |
| Session/bootstrap gate, post-verification routing | `frontend/js/mfa-session.js` |
| Destination configuration | `frontend/js/mfa-config.js` |
| Verified JWT + active role + database gate | `supabase/functions/_shared/mfa-authorization.ts` |
| Authenticated private file fetching (no new signed URLs) | `frontend/js/protected-files.js` |
| Lost-device administrator reset | `supabase/functions/reset-user-mfa/index.ts` |
| RLS, RPC, view, Storage and reset/session authorization | `20261003135544_modular_totp_mfa.sql` |
| Final database enforcement switch | `20261003141918_activate_totp_enforcement.sql` |

The service uses `enroll`, `listFactors`, `challenge`, `verify`, `getAuthenticatorAssuranceLevel` and `unenroll`. TOTP verification/secret storage is exclusively Supabase Auth's responsibility. The application never stores setup keys in local/session storage, a database, URLs, logs, or audit metadata. Enrollment data appears only in page memory and DOM, cleared after verification, cancellation, sign-out or page departure. Abandoned unverified factors created by this application are cleared before a fresh enrollment. Never run session-replay/DOM-capture analytics on `mfa.html`.

## Authorization coverage

- Existing table ownership/role policies remain; a **restrictive** authenticated policy adds the MFA gate to all current public base tables and Storage objects. Role/status checks are not replaced with `aal2` alone.
- The gate requires an active profile and a live matching `auth.sessions` entry. Once activated, required roles also need a signed `aal2` claim, TOTP authentication in `amr`, and a verified TOTP factor in Auth.
- Security-definer RPCs are wrapped behind the same gate; their original implementations and role checks are copied into the non-exposed `app_private` schema, with client execution revoked. Explicit scoring/admin maintenance operations retain staff/admin requirements.
- Views become `security_invoker`; direct client access to materialized results is revoked. Server reports still use a service client, but only after the Edge Function verifies the caller and checks MFA.
- The shared Edge gate cryptographically checks `auth.getUser(token)` **before** reading JWT claims, then calls the own-account bootstrap RPC with the caller's token. It gates create-user, resend-user-invite, score-submission, generate-report, notify, application review and administrator MFA reset before privileged work.
- Scheduled/database maintenance and service-role calls remain trusted server paths, not browser paths. Never expose the service-role key or `app_private` schema through the Data API.
- `mfa_bootstrap` is an intentional authenticated pre-MFA exception: it returns only the caller's id, role, active/blocked flags, required-MFA flag and access decision, not email, names, proofs or other users.
- Public sign-in/password recovery and public applications remain public and light-themed. Public rankings use `public_barangay_rankings`, which returns **only barangay names and ranks**. Existing intentionally public catalog/ranking-snapshot reads and public avatars are not confidential data; MFA cannot make already published content private.
- New tables/RPCs/Edge Functions must opt into this architecture: add the restrictive policy or call the shared gate, preserve the business role/ownership checks, and extend tests. Existing policies on future tables are not automatically sufficient.
- MOV previews/downloads and application proofs now call authenticated Storage `download` and display in-memory object URLs, not remote signed URLs. Each remote fetch uses the current session and restrictive Storage RLS; a preview's Download button fetches again. Local object URLs are revoked on modal closure/page departure. Netlify CSP allows `blob:` only where these local previews need it (images, frames and fetch), without allowing blob scripts.

## Configuration

The **database** is the authority for role enforcement. From a trusted migration/admin SQL session only:

```sql
update app_private.mfa_policy
set required_roles = array['super_admin','barangay_secretary']
where singleton;
```

Do not use editable `user_metadata` for authorization. `MFA_CONFIG.requiredRoles` is UI documentation, not a security bypass. Configure destinations in `mfa-config.js` or `window.__MFA_CONFIG__` before loading that module. Destinations must be same-directory `.html` filenames; arbitrary external URLs and user-provided `next` URLs are rejected.

No MFA secret is needed in Edge Function environment variables. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; only server-side code may access the service-role key. Keep existing email/application redirect settings intact. All functions retain `verify_jwt = true`.

## Deployment order — do not push all pending migrations blindly

1. Confirm the target is MORC DILG / DILGpart2 (`nptfdsblgsufghdtnjvk`). Obtain approval for the permission changes and schedule a short maintenance window. Back up the database/current functions and keep the previous frontend deployment available. Inventory unrelated pending migrations rather than pushing them accidentally.
2. Confirm Auth → Multi-factor authentication → TOTP is **Enabled** for enrollment/verification, with **at least two** factor slots (currently 10). Do not replace all hosted Auth settings with the local config; its localhost site URL is for development.
3. Apply **only** the preparation migration `20261003135544_modular_totp_mfa.sql`. It leaves the final enforcement switch off, but still changes RPC permissions, views and public ranking access, so deploy the next steps in the same window. Check that all expected wrappers, views, table policies and Storage policy exist. Rerun Supabase security advisors. Existing unknown additional RPCs must be reviewed before activation.
4. Deploy the new frontend including the changed public rankings client and all MFA modules. Live Server automatically serves these local files; Netlify must publish the updated `frontend` directory. Verify first enrollment, existing-factor sign-in and access for all three roles. Enroll **at least two separate Super Administrators** with independently held devices before activating production enforcement. Do not record their keys or codes.
5. Deploy the gated Edge Functions: create-user, resend-user-invite, score-submission, generate-report, notify, review-account-application, reset-user-mfa. Include `_shared/mfa-authorization.ts` and `_shared/account-applications.ts` where imported. Rebundle submit-account-application with its updated shared dependencies (its public endpoint remains exempt). Existing live business logic was inspected and matches local copies before this patch.
6. **Retire the old hosted request-email-mfa, verify-email-mfa and email-mfa-status functions.** They were removed locally earlier but remain hosted. Delete them through the CLI/dashboard or deploy the shared 410 tombstone at `_shared/retired-email-mfa.ts` under each old slug; keep JWT verification enabled. The legacy table is client-inaccessible; email verification must never be treated as completed TOTP.
7. Apply `20261003141918_activate_totp_enforcement.sql` **last**. Confirm `app_private.mfa_policy.enabled = true`. Without this step the database is not enforcing TOTP. Perform the smoke checks below, including direct requests, and rerun advisors.

Discover CLI commands/flags through `supabase --help`, `supabase functions --help`, `supabase db --help` before deployment. Do not copy management tokens from a browser into application files. Local Auth config contains legacy settings; unrelated historical migration 0012 also requires an existing view to be dropped/recreated when bootstrapping from scratch. The isolated test mirrors that legacy prerequisite; it does not change the hosted schema.

## First-time and subsequent sign-ins

1. Sign in with an approved account's password. No private profile query or login audit write occurs before the MFA gate.
2. If no verified factor exists, scan the provider QR code or enter the manual setup key in a TOTP app. Enter the six-digit code. Only Supabase verifies it.
3. Existing users select their authenticator and enter its current six-digit code. Codes are never included in URLs or logs.
4. After successful verification, the fresh session and database gate are checked again, then the configurable destination opens. Check the device's automatic time if codes fail; wait for the next code and retry. Provider challenge/error limits still apply.

## Authenticator replacement

Open your profile → **Manage authenticator**, with an already verified session. Select the old device, then **Replace this authenticator**. The new factor is enrolled and verified first. Only then is the old one removed. A failed new code leaves the old factor untouched. A failed old-factor removal retains both verified factors and offers removal retry. Removal retry is idempotent if deletion succeeded but session refresh failed. Refresh/downgrade may require verifying the remaining new factor again. Cancelling after new-factor verification deliberately keeps the working new factor; it is not silently deleted.

Never remove the only verified authenticator first, and never retain the manual key in an application database as a recovery mechanism.

## Lost-device recovery / administrator reset

1. Contact another Super Administrator. They must independently verify your identity/appointment through an approved organizational process; possession of an email address alone is insufficient. Record a support ticket / identity-check reason. Do not place passwords, codes, document numbers, setup keys or sensitive identity-document contents in that reason.
2. That administrator signs in with their own TOTP and opens Admin Consoles → Users → **Reset authenticator**. Self-reset is prohibited; inactive targets must use the existing account-status process first.
3. The service-only SQL ledger blocks the target before provider deletions, records a cutoff timestamp and audit event, then the server uses `auth.admin.mfa.listFactors` and `deleteFactor` to remove factors. Provider deletion of a verified factor logs out sessions; the database additionally rejects stale sessions/tokens and requires a new TOTP `amr` timestamp after the cutoff.
4. Only after all factors are gone is the blocked flag cleared. No `aal1` exception is issued. The user signs in with their password and enrolls/verifies a new authenticator. Forgotten passwords use the existing recovery flow, separately; recovery does not bypass TOTP.
5. Partial failures keep the target blocked. Wait five minutes (concurrent reset lock), reconfirm the ticket/identity and retry. Never clear the blocked flag merely because an HTTP request failed.

### Last Super Administrator / project-owner break glass

If every administrator loses a device, the ordinary in-site reset cannot be used. The authorized Supabase project owner must independently verify the person and use their own protected Supabase organization/project access. From a trusted SQL/admin session, block the target in `app_private.mfa_resets` and set `tokens_valid_after` to the next whole second, recording an audit event and incident ticket. Then remove the user's factors through the supported Auth dashboard/Admin MFA API. Confirm **no factors remain** before clearing `blocked`. The epoch must stay in place. The person must password-sign-in and verify fresh TOTP before any private access. Never disable the global MFA policy or set a forged `aal2` flag to recover one user. Keep the organization's project-owner access recovery process separate from this application.

## Verification

```powershell
npm ci --ignore-scripts
npm run test:mfa
node --test tests/account-applications.test.cjs tests/submission-deadline.test.cjs tests/recovery-routing.test.cjs tests/deadline-filters.test.cjs tests/calendar-migration.test.cjs
$env:PLAYWRIGHT_MODULE = 'C:/Users/Marc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:PW_TEST_SCREENSHOT_NO_FONTS_READY = '1'
node tests/mfa.browser.cjs
```

PGlite runs the actual migration chain and new RLS/RPC policies in an isolated real PostgreSQL engine, with fixture Auth/session/factor tables (no real secrets). It checks `aal1` denial, `aal2` success, inactive/role denial, Storage, public/private RPC permissions and reset-session rejection. Server/service tests verify JWT validation precedes claim use, password-only API denial, verified API success and safe factor-replacement ordering/failure. Browser fixtures cover setup SVG/manual key, six-digit retry, existing factors, replacement, DOM clearing and responsive/light/dark screens. Existing account-application, UI/chart and password-recovery suites are regression checks. These tests do **not** prove a live authenticator enrollment or deployment has occurred.

### Production smoke checks after activation

- New password-only session: minimal bootstrap allowed, private profile/submission/document/report/application-review requests denied. SELECT may return empty rows under RLS; protected RPC/API must reject.
- Same account after TOTP: appropriate role/ownership data accessible. Secretary must still be denied administrator APIs; inactive account still denied.
- Call protected REST, RPC and function endpoints directly, skipping the UI. Confirm `aal1` denied and `aal2` succeeds only where its role/ownership permits.
- Open public rankings anonymously and while signed in with `aal1`; only names/ranks returned. Sign-in/reset/public rankings remain light-themed.
- Upload/preview a permitted MOV and avatar after MFA; verify other barangays' proofs remain private. Existing signed Storage URLs are bearer links and remain usable until their expiry; revoke/rotate sensitive leaked links separately. RLS cannot retroactively revoke a previously issued signed URL.
- Replace with an invalid code: old app still works. Replace successfully: new app works, old factor disappears. Exercise administrator reset on a disposable test account, not a real user without authorization.
- Verify account application approval, emails, scoring, reports, and scheduled maintenance still work. Run advisors after activation; investigate unrelated existing warnings rather than claiming a clean audit.

## Dependency/advisor notes

The existing SDK 2.49.8 API signatures (including Admin MFA list/delete) were checked against its installed source. Its transitive auth-js has a low-severity malformed-path advisory: https://github.com/advisories/GHSA-8r88-6cj9-9fh5. Factor and administrator target IDs are restricted to UUIDs; schedule a separately tested SDK upgrade across all HTML pages and Edge imports. No automatic major/bulk dependency fix was run.

Before deployment, hosted advisors still report legacy security-definer views, public security-definer RPC permissions, materialized-view exposure and mutable search paths. This patch addresses access paths touched by MFA, including pinning helper/trigger search paths; it does not claim a full-project security audit. Advisor guidance: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view and https://supabase.com/docs/guides/database/database-linter?lint=0016_materialized_view_in_api.

Provider references: https://supabase.com/docs/guides/auth/auth-mfa, https://supabase.com/docs/reference/javascript/auth-mfa-enroll, https://supabase.com/docs/reference/javascript/auth-admin-deletefactor.
