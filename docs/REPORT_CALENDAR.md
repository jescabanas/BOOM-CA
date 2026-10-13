# Compliance report calendar

The displayed order is Weekly, Monthly, Quarterly, Semestral, Annual.
Every year has 48 weekly reports (four per month), 48 monthly reports
(four per month), four quarterly reports, two semestral reports (January–June
and July–December), and one annual report.

Names follow `January Weekly Report 1`, `January Monthly Report 1`,
`Quarterly Report 1`, `Semestral Report 1`, and `Annual Report 2026`.
Scheduled names are generated automatically.

Editing a scheduled deadline repeats its date pattern within the selected year:

- Weekly: the same report number in all twelve months.
- Monthly: the same report number in all twelve months.
- Quarterly: the same relative dates in all four quarters.
- Semestral: the same relative dates in both six-month periods.
- Annual: the single report for the selected year.

Days beyond a month's last day are clamped to that last day. Times use
Asia/Manila. Other report numbers and open/closed flags remain unchanged.
Saved patterns also apply if a missing occurrence is generated later.
History uses the assigned occurrence rather than the upload month, so a November
report uploaded in October appears under November.

Internal rankings show only rank, barangay, and compliance rate. Public rankings
keep the existing three columns and responsive layout, with raised rounded rows
and no percentage or column header bars. Public cards use the title's display
font; the back control is an arrow at the right. Internal columns are centered.
Review excludes unsent drafts and records without current, non-empty evidence.

## Release order

The three migrations below were applied to the connected DILGpart2 database on
October 6, 2026. The updated account-application function is deployed there.
Frontend changes are in the local checkout and need publishing for the hosted site.

1. Apply `20261005150552_submission_document_revisions.sql` if missing.
2. Apply `20261006133805_required_evidence_and_application_documents.sql`.
3. Apply `20261006133819_recurring_report_calendar.sql`.
4. Deploy `submit-account-application` with its updated shared modules.
5. Publish the updated frontend with the function so applicants see all three required uploads.

The calendar migration preserves existing report IDs, submissions, and dates.
Existing manual monthly reports fill available numbered slots before new
occurrences are generated. Database and browser fixture tests make no hosted
writes or send email.

`node tests/connected-report-smoke.cjs` verifies the live API functions are in
the schema cache and anonymously inaccessible, and confirms each application
document is required. It creates no records, uploads, accounts or email.
