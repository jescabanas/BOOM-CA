# Developer Guide

## 1. Local Setup

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli), Docker
(for local Supabase), Node.js 20+ (for Netlify CLI, optional).

```bash
# Start local Supabase (Postgres + Auth + Storage + Studio)
supabase start

# Apply all migrations
supabase db reset   # or: supabase db push

# Serve Edge Functions locally
supabase functions serve --env-file .env

# Serve the frontend (any static server works)
cd frontend
python3 -m http.server 8888
# then edit frontend/env.js to point at your local Supabase URL/anon key
```

## 2. Migration Conventions

- Migrations are numbered and run in order: `0001_init_schema.sql` →
  `0006_storage.sql`. Never edit a migration that's already been applied to
  a shared environment — add a new numbered file instead.
- Every table gets RLS enabled in `0002_rls_policies.sql`, even ones that
  are effectively public-read, so the intent is explicit and future columns
  don't accidentally leak.
- All privileged writes (audit logs, score history, notifications) go
  through `SECURITY DEFINER` functions rather than direct table policies —
  keep this pattern when adding new privileged write paths.

## 3. Frontend Conventions

- No build step / bundler — plain ES2023 modules loaded via `<script>` tags,
  in this order on every protected page: `env.js` → `supabaseClient.js` →
  `auth.js` → `layout.js` → (page-specific: `charts.js`, `export.js`) →
  inline page script.
- Every protected page starts with `await guardPage([...allowedRoles])`,
  which redirects unauthenticated users to `index.html` and
  wrong-role users to their own home page.
- `renderSidebar(activePage, role)` (in `layout.js`) is the single source of
  nav items per role — add new pages there, not by copy-pasting `<nav>`
  markup.
- Design tokens (colors, type, spacing) live in `frontend/css/styles.css`
  under `:root` — reuse these variables rather than hardcoding hex values in
  new pages.

## 4. Adding a New Report Type

1. Add a `case` in `supabase/functions/generate-report/index.ts` that
   queries the relevant table/view.
2. If the report needs a new aggregate, add a view in a new migration file
   rather than querying raw tables from the Edge Function.
3. Call it from the frontend via `requestServerReport('your_report_type')`
   (see `frontend/js/export.js`).

## 5. Adding a New Role Permission

1. Update the `user_role` enum if it's a new role (requires a migration —
   Postgres enums need `ALTER TYPE ... ADD VALUE`, which cannot run inside a
   transaction block with other DDL, so give it its own migration file).
2. Add/adjust RLS policies in a new migration — never edit
   `0002_rls_policies.sql` in place once deployed.
3. Update `ROLE_HOME` and `ROLE_LABEL` in `supabaseClient.js`, and
   `NAV_BY_ROLE` in `layout.js`.

## 6. Extension Points Called Out Elsewhere in the Docs

- **Barangay rename/edit form** (Administrator Manual §2) — add an edit
  modal to `admin.html`'s Barangays tab following the same pattern as the
  existing "New User" modal.
- **Mandate period creation form** (Administrator Manual §3) — same pattern,
  inserting into `mandate_periods`.
- **Real virus scanning** (README §7) — replace the
  `documents.scan_status` placeholder with a call to a scanning provider,
  triggered from a Storage webhook or the `handle_document_upload` flow.

## 7. Testing

See `docs/TESTING_GUIDE.md`.
