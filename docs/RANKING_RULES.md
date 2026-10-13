# Ranking calculation

Monthly means all reports assigned to that calendar month, including weekly
reports and manually created requirements, rather than only the four Monthly
Report slots. **A report is Not Submitted only when there is no valid submission
and its exact deadline has passed.** At the exact cutoff it is still Upcoming.
This deadline rule applies to ongoing and future periods as well as history.

Each barangay's assessed-report total includes reports whose deadlines have
passed, plus reports that barangay has already submitted early. Unsubmitted
future requirements are Upcoming and are excluded from the score denominator.
An early submission by another barangay does not turn your future requirement
into a missing report or lower your percentage.

Each report can earn:

- **5 points (Advanced):** submitted before the deadline's calendar day.
- **3 points (On time):** submitted on the deadline day at or before its cutoff.
- **0 points:** after the cutoff, missing, rejected or returned for correction.

Dates and cutoff times use the Philippines timezone. The existing strict
deadline rule is retained: grace-period settings do not turn a late upload into
a three-point upload. Pending review scores are provisional and become zero
if rejected or returned. First submitted time determines timeliness; review
time and resubmission time do not rewrite it.

Only submissions with a timestamp and a current, nonempty MOV file that exists
in private Storage qualify. Drafts and historical empty-file submissions do
not count. Each barangay/report pair counts once, regardless of file count or
revisions. Current timestamps are checked against the report deadline, rather
than trusting an old stored score after a deadline edit.

**Compliance rate = total earned points / (assessed reports × 5) × 100.**
When no reports are assessed the rate is zero; there is no division by zero.

After four report deadlines pass, two advanced and two late reports earn
10/20 = 50%. One advanced report and three overdue missing reports earn
5/20 = 25%. Before those deadlines pass, one early advanced submission earns
5/5 = 100%, with the remaining future reports excluded. Two advanced and two
late submissions still earn 10 points and rank ahead of that one advanced
submission's 5 points, even if their percentage is lower.
Rank order is total points descending, then approved-report count descending,
then natural barangay name order for stable ties.

**Compliant Barangays** counts active barangays with at least one approved report
in the selected period. This is an approval indicator, not a claim that all
requirements are complete or that the rate is 100%. Dashboard counts, ranking
counts and highlighted rows use the same ranking result. A newer pending report
does not erase an earlier approval on another report.

Public rankings use the same calculation but expose only barangay names and
ranks. Empty months keep the existing unranked name list. Calendar membership
uses assigned occurrences, so deadline edits and early uploads do not move a
report into another month.

Implementation: `20261007035811_fair_report_rankings_and_visible_accounts.sql`,
updated by `20261007044239_deadline_aware_analytics_rankings.sql`.
Regression checks: `tests/mfa-database.test.cjs` and
`tests/analytics-explorer.browser.cjs`.
