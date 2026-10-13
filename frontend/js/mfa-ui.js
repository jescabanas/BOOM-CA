(async () => {
  const service = createMfaService(supabaseClient);
  const $ = id => document.getElementById(id);
  let enrollmentId = null, oldId = null, newVerified = false, replacing = false, busy = false;
  function clearSetup() {
    $("mfa-qr").removeAttribute("src"); $("mfa-key").textContent = "";
    $("mfa-setup").hidden = true; $("mfa-code").value = "";
  }
  function message(text) { $("mfa-message").textContent = text; }
  function failure(error) {
    const text = String(error?.message || "Verification could not be completed.");
    if (["This account is not active. Contact your administrator.",
      "An administrator is resetting this authenticator. Contact your administrator before retrying.",
      "Account security checks are unavailable. Please retry or contact your administrator."].includes(text)) { message(text); return; }
    // Never display provider payloads containing enrollment material.
    message(/code|otp|expired|invalid/i.test(text) ? "That code could not be verified. Check your phone’s automatic time, wait for a new code, and try again." : "Security operation failed. Retry, or contact your administrator if it continues.");
  }
  async function enroll() {
    await service.clearAbandonedEnrollments();
    const data = await service.enroll(); enrollmentId = data.id; newVerified = false;
    $("mfa-title").textContent = replacing ? "Set up your replacement" : "Set up your authenticator";
    $("mfa-description").textContent = "Use Google Authenticator, Microsoft Authenticator, or another TOTP app. Scan the QR code, then verify a code below.";
    $("factor-field").hidden = true;
    const qr = data.totp.qr_code;
    const svg = qr.startsWith("data:image/svg+xml") ? qr.slice(qr.indexOf(",") + 1) : qr;
    // SDK 2.49.8 returns a data URI with raw SVG. Encode it to preserve '#' colors.
    $("mfa-qr").src = svg.trim().startsWith("<svg") ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) : qr;
    $("mfa-key").textContent = data.totp.secret; $("mfa-setup").hidden = false;
    $("mfa-form").hidden = false; $("mfa-code").focus();
  }
  async function finish() {
    clearSetup();
    await MfaSession.routeAfterPassword();
  }
  async function initialize() {
    $("mfa-retry").hidden = true;
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) { location.replace("index.html"); return; }
      const account = await MfaSession.bootstrap();
      const factors = await service.factors(), assurance = await service.assurance();
      const manage = new URLSearchParams(location.search).get("manage") === "1";
      if (account.access_allowed && (!account.mfa_required || assurance.currentLevel === "aal2") && !manage) { await finish(); return; }
      if (!factors.length) { await enroll(); return; }
      $("mfa-factor").replaceChildren(...factors.map(f => new Option(f.friendly_name || "Authenticator", f.id)));
      $("factor-field").hidden = false;
      $("mfa-code").required = true; $("mfa-submit").textContent = "Verify and continue";
      $("mfa-description").textContent = "Enter the current code from your authenticator. Your password alone does not grant system access.";
      $("mfa-form").hidden = false;
      // Replacement cannot start with a password-only session.
      $("mfa-replace").hidden = !account.access_allowed || assurance.currentLevel !== "aal2";
      $("mfa-code").focus();
    } catch (error) { failure(error); $("mfa-retry").hidden = false; }
  }
  $("mfa-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return; busy = true; $("mfa-submit").disabled = true; message("");
    try {
      const code = $("mfa-code").value.trim();
      if (!newVerified) {
        await service.verify(enrollmentId || $("mfa-factor").value, code);
        if (enrollmentId) { newVerified = true; clearSetup(); }
      }
      if (replacing) {
        // A failure here keeps the newly verified authenticator; retry only removal.
        await service.retireOldFactor(enrollmentId, oldId);
        replacing = false; enrollmentId = null; newVerified = false;
        $("mfa-cancel").hidden = true;
        message("Previous authenticator removed. Verify your replacement if asked to continue.");
        await initialize(); return;
      }
      await finish();
    } catch (error) {
      if (replacing && newVerified) {
        message("Your new authenticator works. Removal of the old one could not be confirmed. Retry removal; do not discard your new authenticator.");
        $("mfa-code").required = false; $("mfa-submit").textContent = "Retry removing old authenticator";
      } else failure(error);
    } finally { busy = false; $("mfa-submit").disabled = false; $("mfa-code").value = ""; }
  });
  $("mfa-replace").onclick = async () => {
    if (busy) return; busy = true;
    try {
      if (!(await MfaSession.requireAccess())) return;
      oldId = $("mfa-factor").value; replacing = true;
      $("mfa-replace").hidden = true; $("mfa-cancel").hidden = false;
      await enroll();
    } catch (error) { failure(error); } finally { busy = false; }
  };
  $("mfa-cancel").onclick = async () => {
    if (busy) return; busy = true;
    try {
      // A verified new factor is intentionally retained, never silently removed.
      if (enrollmentId && !newVerified) await service.cancelEnrollment(enrollmentId);
      location.replace(MfaSession.destination((await MfaSession.bootstrap()).role));
    } catch (error) { failure(error); } finally { busy = false; clearSetup(); }
  };
  $("mfa-retry").onclick = initialize;
  $("mfa-signout").onclick = async () => { if (busy || !(await confirmLogout())) return; clearSetup(); await supabaseClient.auth.signOut(); location.replace("index.html"); };
  window.addEventListener("pagehide", clearSetup);
  await initialize();
})();
