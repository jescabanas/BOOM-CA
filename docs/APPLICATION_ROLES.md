# Application roles

The supported signed-in roles are **Super Administrator** (`super_admin`) and **Barangay Secretary** (`barangay_secretary`). Public rankings remain available without an account.

Administrators manage users, barangays, requirements, and deadlines, and retain city-wide analytics, submission review, rankings, history, and exports. Secretaries submit and track work for their assigned barangay. New User invites or restores only administrators; secretary access continues through reviewed Account Applications and Barangay Access.

HUC Director was retired on October 13, 2026. There were zero profiles using it, so no account was deleted or promoted. Submission review notifications now go to active administrators. The database rejects assigning the retired role, invitations reject it, and authorization rules no longer grant it access. The historical enum label is retained for migration compatibility and cannot be assigned to a profile.

The database migration and create-user (version 11), generate-report (version 8), and score-submission (version 8) were applied to DILGpart2. The updated frontend is saved locally; publishing to dilgtest2.netlify.app still requires access to its owning Netlify account. The currently connected Netlify account does not expose that site.

Verification: all 65 automated tests pass. The local invitation-dialog browser test passes. The database regression covers retired-role rejection, administrator and secretary permissions, preservation of profiles, and administrator notification routing. MFA enforcement remains off; role removal does not activate it.

Migration: `supabase/migrations/20261012172035_remove_huc_director_role.sql`.
