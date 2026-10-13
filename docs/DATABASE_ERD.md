# Database Entity-Relationship Diagram

Rendered as Mermaid — paste into https://mermaid.live or view directly in any
Markdown renderer that supports Mermaid (GitHub, GitLab, Obsidian, etc.).

```mermaid
erDiagram
    CLUSTERS ||--o{ BARANGAYS : groups
    BARANGAYS ||--o{ PROFILES : "secretary assigned to"
    BARANGAYS ||--o{ SUBMISSIONS : submits
    BARANGAYS ||--o{ RANKING_SNAPSHOTS : ranked_in

    MANDATES ||--o{ MANDATE_PERIODS : "recurs as"
    MANDATE_PERIODS ||--o{ SUBMISSIONS : "evaluated by"

    SUBMISSIONS ||--o{ DOCUMENTS : attaches
    SUBMISSIONS ||--o{ SCORES : "scored via"
    SUBMISSIONS }o--|| PROFILES : "submitted_by"
    SUBMISSIONS }o--|| PROFILES : "evaluator_id"

    PROFILES ||--o{ AUDIT_LOGS : performs
    PROFILES ||--o{ NOTIFICATIONS : receives
    PROFILES ||--o{ DOCUMENTS : uploads

    CLUSTERS {
        uuid id PK
        text name
        text description
    }
    BARANGAYS {
        uuid id PK
        text code
        text name
        uuid cluster_id FK
        boolean is_active
    }
    PROFILES {
        uuid id PK "references auth.users"
        text full_name
        text email
        user_role role
        uuid barangay_id FK
        boolean is_active
    }
    MANDATES {
        uuid id PK
        text title
        text category
        text[] required_file_types
        integer max_points
        mandate_status status
    }
    MANDATE_PERIODS {
        uuid id PK
        uuid mandate_id FK
        integer year
        integer quarter
        timestamptz deadline_at
        integer grace_period_hours
        boolean is_open
    }
    SUBMISSIONS {
        uuid id PK
        uuid barangay_id FK
        uuid mandate_period_id FK
        timestamptz submitted_at
        submission_status status
        score_band score_band
        numeric points_awarded
        uuid evaluator_id FK
        boolean is_locked
    }
    DOCUMENTS {
        uuid id PK
        uuid submission_id FK
        text file_name
        text storage_path
        integer version
        boolean is_current
        text scan_status
    }
    SCORES {
        uuid id PK
        uuid submission_id FK
        numeric points
        score_band band
        timestamptz calculated_at
    }
    RANKING_SNAPSHOTS {
        uuid id PK
        integer year
        integer quarter
        uuid barangay_id FK
        numeric total_points
        numeric compliance_rate
        integer rank
    }
    AUDIT_LOGS {
        uuid id PK
        uuid user_id FK
        text action
        text entity_table
        uuid entity_id
        jsonb metadata
        timestamptz created_at
    }
    NOTIFICATIONS {
        uuid id PK
        uuid recipient_id FK
        notification_type type
        text title
        text message
        boolean is_read
    }
    SYSTEM_SETTINGS {
        text key PK
        jsonb value
    }
```

## Enum Reference

| Enum | Values |
|---|---|
| `user_role` | Active application roles: super_admin, barangay_secretary. Legacy enum labels remain for historical migration compatibility. |
| `submission_status` | pending, under_review, approved, rejected, missing, correction_requested |
| `score_band` | on_time, grace_period, late, rejected, missing |
| `mandate_status` | active, archived, draft |
| `notification_type` | submission_received, submission_approved, submission_rejected, correction_requested, deadline_approaching, deadline_passed, evaluation_completed, system |

## Key Constraints

- `submissions` has a unique constraint on `(barangay_id, mandate_period_id)` —
  one submission per barangay per mandate period, with a version history
  captured through the `documents.version` field and the `scores` audit trail
  rather than duplicate submission rows.
- `profiles` enforces `barangay_id is not null` whenever `role =
  'barangay_secretary'` via a CHECK constraint.
- `ranking_snapshots` and `mv_barangay_performance` are derived/denormalized
  tables — never edited directly, always regenerated from `submissions`.

See `supabase/migrations/0001_init_schema.sql` for the authoritative, fully
commented schema.
