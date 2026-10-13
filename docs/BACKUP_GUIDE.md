# Backup & Restore Guide

## 1. Automatic Backups (Supabase-managed)

On paid Supabase plans, daily backups are automatic:
Dashboard → Project Settings → Database → Backups. Point-in-time recovery
(PITR) is available on higher tiers for finer-grained restore.

## 2. Manual Backups

```bash
# Full database dump (schema + data)
supabase db dump -f backup_$(date +%Y%m%d).sql

# Schema only (useful for diffing against migrations)
supabase db dump --schema-only -f schema_$(date +%Y%m%d).sql

# Data only
supabase db dump --data-only -f data_$(date +%Y%m%d).sql
```

Store dumps offsite (encrypted cloud storage bucket separate from Supabase
itself) on a schedule matching your records-retention policy — DILG
compliance data should not have a single point of failure.

## 3. Storage (MOV Documents) Backup

Database dumps do **not** include Supabase Storage file contents. Sync the
`mov-documents` bucket separately:

```bash
# Using the Supabase CLI's storage commands, or the Management API,
# mirror the bucket to local/offsite storage on a schedule, e.g.:
supabase storage cp -r ss:///mov-documents ./mov-documents-backup
```

(Exact command syntax may change between CLI versions — check
`supabase storage --help` for your installed version.)

## 4. Restore Procedure

1. Provision a fresh Supabase project (or a staging project for a rehearsal
   restore — always test restores before you need them for real).
2. Restore the schema/data dump:
   ```bash
   psql "$DATABASE_URL" -f backup_YYYYMMDD.sql
   ```
3. Re-deploy Edge Functions (`supabase functions deploy ...`) — these aren't
   part of a `pg_dump`.
4. Restore the `mov-documents` bucket contents from your storage backup.
5. Re-point `SUPABASE_URL` / keys in Netlify env vars if restoring to a new
   project, and redeploy the frontend.
6. Run the post-deploy checklist in `DEPLOYMENT_GUIDE.md` §6 to verify
   integrity (cron jobs registered, leaderboard loads, etc.).

## 5. Recommended Backup Cadence

| Data | Frequency | Retention |
|---|---|---|
| Full DB dump | Daily (automatic, Supabase-managed) | 7–30 days rolling, per plan |
| Offsite manual dump | Weekly | 1 year+ (compliance) |
| Storage bucket sync | Weekly or after major submission cycles | 1 year+ |

Adjust retention to match your agency's records-retention policy for
government compliance documentation.
