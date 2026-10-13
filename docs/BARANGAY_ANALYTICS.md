# Barangay Analytics

Barangay secretaries open **Analytics** from their sidebar. The page uses the same surfaces, colors, charts and analytics-period controls as the administrator dashboard, scoped to the secretary's active barangay assignment.

## Metrics and reports

- Required, submitted, not submitted, late and pending review report counts.
- Current rank as the first metric card; compliance rate and earned/possible points in Performance Summary.
- Advanced, deadline-day, late, approved, rejected and returned report counts.
- Trends by first submission date, submitted/missing breakdown, and submitted versus required reports by compliance type.
- A report tracker with status, deadline, first submission, timing and points. Metric cards filter this tracker; its dropdown also supports overdue and review-status filters.

Weekly, monthly, quarterly, semestral and annual selections match administrator analytics. Reports belong to their assigned occurrence, even if uploaded early or their deadline moves. Trends retain early uploads outside the selected period. Counts describe report requirements, not individual attached files or revision attempts.

Submitted reports require a submission timestamp and a current, nonempty document backed by an existing MOV Storage object. Empty legacy submissions and drafts do not count as submissions. **Not Submitted counts only reports without a valid submission after the exact deadline has passed.** At the exact cutoff and before it, these reports are Upcoming. The breakdown and tracker distinguish Upcoming from Not Submitted. Rejected and returned reports remain submitted but earn zero points. The Not Submitted card uses a darker red than Late Submissions.

Scoring matches [Ranking Rules](RANKING_RULES.md): advanced reports earn 5 points, deadline-day reports submitted before the cutoff earn 3, and late/missing/rejected/returned reports earn 0. Pending review points are provisional. Compliance rate is earned points divided by five times assessed reports: reports already due or already submitted by this barangay. Future unsubmitted reports do not lower the rate. Required Reports still shows the full schedule. Rank remains based on total points, then approvals, rather than percentage. This is a weighted performance percentage, separate from the submitted-versus-required chart.

## Access and continuity

`public.my_barangay_analytics(text,text)` is a protected invoker wrapper. Its private implementation requires verified MFA, an active Barangay Secretary profile and an active barangay. It derives the barangay from `auth.uid()` and takes no barangay ID from the caller. The response contains only that barangay's metrics and report tracker, plus its shared ranking position. Account emails and document paths are not returned.

Submission authorship does not limit barangay history: the assigned replacement sees predecessors' submissions, including files whose author has been removed. Removed, inactive, anonymous and password-only callers cannot access analytics.

Refresh reloads the current data. Loading failures clear stale metrics/charts, show an inline error and allow retry. Theme changes redraw the charts. On narrow screens cards stack and the report table scrolls within its container.

The trend and breakdown preview cards stay 360px high, and the compliance-type card stays 380px high regardless of data or period. Each has the same expand control and dialog layout as administrator analytics. Expanded charts support chart/legend clicks and keyboard filters, with matching reports alongside the plot. Expansion reads only the existing authorized barangay snapshot and leaves the preview data unchanged. Escape or the close button returns focus to the opener; refresh closes any expanded chart and disables expansion while loading. Expanded views also follow theme changes and stack on mobile.

## Validation

- `node --test tests/*.test.cjs`: real PostgreSQL fixtures verify counts, shared scoring, legacy no-file exclusion, empty periods, historical continuity and caller permissions.
- `tests/barangay-analytics.browser.cjs`: real frontend/Chart.js with local fixtures verifies charts, filtering, escaped report titles, all five period types, empty/error recovery, fixed preview sizes, expanded chart clicks/filters, focus and cleanup, and desktop/mobile light/dark layouts.
- `tests/analytics-explorer.browser.cjs`: administrator chart regression coverage.
- `node tests/barangay-analytics.live.cjs`: non-writing check that the deployed endpoint exists and rejects anonymous requests.

Migrations: `20261007041349_own_barangay_performance_analytics.sql` and `20261007044239_deadline_aware_analytics_rankings.sql`. No existing accounts, submissions or files are altered by installing this feature. Frontend files must be published through the normal frontend deployment separately.
