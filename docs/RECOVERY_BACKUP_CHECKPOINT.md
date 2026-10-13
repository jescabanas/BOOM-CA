# Recovery backup checkpoint — 4 October 2026

Target: **MORC DILG / DILGpart2**, project ref `nptfdsblgsufghdtnjvk`.

Location: `C:/Users/Marc/Downloads/DILG Recovery Backup`.

## Collected

- `Database/roles.sql`: database role export.
- `Database/schema.sql`: application structure, functions and policies.
- `Database/data.sql`: application records plus Auth and Storage metadata.
- `Database/managed-schema.sql`: Auth/Storage definitions and migration-history structure, including the seven existing Storage policies.
- `Database/migration-history.sql`: twelve recorded migration entries.
- `Storage/mov-documents/mov-documents/`: 51 uploaded files, 25,758,355 bytes.
- `Storage/avatars/avatars/`: 11 avatars, 3,202,903 bytes.
- `Storage/account-application-proofs/`: empty bucket at this checkpoint.
- `LiveServer/supabase/functions/`: all ten deployed functions, including the shared account-application module. These are **pre-TOTP rollout** versions, separate from the new local MFA code.
- `LiveServer/supabase/config.toml`: pulled hosted configuration, including production site/recovery URLs and enabled TOTP enrollment/verification with ten slots. This is not guaranteed to include custom email bodies or secret values. Never push this file merely to restore a backup.
- `CurrentApplication/`: fresh application source/configuration snapshot. The earlier `DILGtest2/` copy is preserved unchanged; its `frontend/index.html` differs from the current application.
- `BACKUP-CHECKPOINT.json`: generated verification results, deployed function versions/JWT flags, exact downloaded object directories, and SHA-256 checksums.

## Offline checks

The verifier compares the four critical table counts with the live checkpoint: 9 Auth users, 9 profiles, 24 submissions, and 24 documents. It checks twelve migration records, all seven Storage policies, every downloaded Storage object's name and byte length, deployed function relative dependencies, the Auth TOTP settings, and source/configuration hashes against `CurrentApplication`.

Helper self-tests: `node backup-tools/verify-recovery-backup.cjs --self-test`.

The verifier creates its report once; it refuses to replace an existing report. It never connects to Supabase and never applies a restore.

## Local database recovery tested

The exports were restored successfully into a disposable PostgreSQL 17.6.1.155 container with no network access or published ports. The restore used one transaction and stopped on SQL errors. A missing non-login Supabase service role was added only to the local container. Storage policies were deferred until their public function dependencies existed. Original exports were not edited.

`RESTORE-CHECKPOINT.json` records the comparison of every exported table's row count and rechecked original backup hashes. The initial `BACKUP-CHECKPOINT.json` is retained as the earlier collection audit. This is a **database-only rehearsal**, not a hosted Auth/Storage service or sign-in test; it does not demonstrate that encrypted MFA factors can be recovered into a different project.

Before live permission/MFA rollout:

1. Preserve custom hosted email template bodies and secret values in an approved private vault. Never send credentials, SQL records, backup archives or setup keys in chat/GitHub. The CLI cannot recover every secret value.
2. For full cross-project disaster recovery, follow provider guidance for Auth encryption/signing material and test hosted service recovery. Do not replay `managed-schema.sql` wholesale into production. The local rehearsal scripts are deliberately restricted to a disposable test database.
3. Refresh the database/file exports if the system changes before deployment. These separate exports/downloads are not an atomic snapshot.
4. Keep the previous deployed frontend available and follow the coordinated sequence in `TOTP_MFA.md`. Do not blindly push historical migrations.

No hosted migrations, deployments, Auth configuration changes, object deletions or account/factor changes were performed during backup collection. CLI exports may use a temporary provider database login role; no business data was changed.

Keep this backup private and on an encrypted device; the Auth data can contain password hashes and session material. Keep a second encrypted offline copy before relying on it for recovery.
