// Dashboard and Review use the same definition of a submitted report.
function isSubmittedWithEvidence(submission) {
  return Boolean(submission.submitted_at && submission.documents?.some(
    document => document.is_current && Number(document.file_size_bytes) > 0
  ));
}
