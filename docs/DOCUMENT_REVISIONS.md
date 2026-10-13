# Compliance attachment revisions

Secretaries can remove or replace current MOV files in their own unlocked
pending, under-review, or returned submissions. This includes weekly compliance.
Approved and locked submissions remain read-only. Remove archives the attachment;
the stored file, original metadata, category links and director remarks remain.
The editor shows Preview and an adjacent × control. Use × to remove the old
file, then choose its replacement in Add MOV files. Saving a new attachment
creates its metadata and category links in one database transaction. A failed
metadata/link operation cannot leave a partial attachment. The first submission timestamp and deadline score
are unchanged. The secretary resubmits through the existing Submit Compliance action.

Apply `20261005150552_submission_document_revisions.sql` before publishing this
frontend. No existing user files are removed by the migration. It adds the
`revise_submission_document` RPC, a secretary ownership/status update policy and
limits authenticated document updates to `is_current`. The RPC runs as the caller
and retains table RLS and MFA requirements. A private helper performs only a
validated submission row lock because the existing submission UPDATE policy
deliberately disallows direct secretary updates while a review is in progress.
The helper verifies active session/MFA, role, ownership, status and lock state.

Also apply `20261006133805_required_evidence_and_application_documents.sql`
before publishing this editor. A draft, resubmission, or approval requires at
least one current, non-empty attachment with a mandate category and an uploaded
Storage object. Empty submissions are blocked by the form, submission RPC, and
database status trigger. Removing the last attachment during a revision is
allowed, but submitting or approving it requires a replacement.

Verification: `node --test tests/mfa-database.test.cjs` uses real PostgreSQL/RLS
in PGlite and checks cross-barangay, MFA, approved/locked and metadata denials,
failed replacement rollback, successful versioning and removal. The browser
fixture `tests/compact-revisions.browser.cjs` checks the controls and failure retry,
along with password visibility, logo sizing and responsive rankings. Browser
fixtures make no hosted writes.

An uploaded replacement whose database transaction fails can remain as an
unreferenced Storage object. It does not replace the original or become a current
attachment; normal orphan-storage maintenance can clean it up separately.
