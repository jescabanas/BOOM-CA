// Run before Supabase consumes the URL fragment on the sign-in page.
// Old emails or an unapproved redirect may fall back to the Site URL.
// Only recovery/invite payloads are forwarded; ordinary sign-in is untouched.
(function () {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const type = hash.get("type") || url.searchParams.get("type");
  const hasToken = hash.has("access_token") || url.searchParams.has("token_hash");
  const isSetup = type === "recovery" || type === "invite";
  const isExpired = hash.get("error_code") === "otp_expired" && hash.has("error");
  if (!(isSetup && hasToken) && !isExpired) return;
  const destination = new URL("reset-password.html", url);
  destination.search = url.search;
  destination.hash = url.hash;
  window.location.replace(destination.href);
})();
