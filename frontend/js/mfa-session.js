window.MfaSession = (() => {
  async function bootstrap() {
    const { data, error } = await supabaseClient.rpc("mfa_bootstrap");
    if (error || !data) throw new Error("Account security checks are unavailable. Please retry or contact your administrator.");
    if (!data.is_active) throw new Error("This account is not active. Contact your administrator.");
    if (data.blocked) throw new Error("An administrator is resetting this authenticator. Contact your administrator before retrying.");
    return data;
  }
  function destination(role) {
    const path = MFA_CONFIG.destinations[role] || "index.html";
    // Configuration must never become an open redirect.
    return /^[a-z][a-z0-9-]*\.html$/i.test(path) ? path : "index.html";
  }
  async function routeAfterPassword() {
    const account = await bootstrap();
    const { currentLevel } = await createMfaService(supabaseClient).assurance();
    if (!account.access_allowed || (account.mfa_required && currentLevel !== "aal2")) {
      location.replace("mfa.html");
      return;
    }
    await recordLogin(account.id);
    location.replace(destination(account.role));
  }
  async function recordLogin(id) {
    await supabaseClient.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", id);
    await supabaseClient.rpc("log_audit_event", { p_user_id: id, p_action: "LOGIN", p_entity_table: "profiles", p_entity_id: id, p_metadata: { mfa: true } });
  }
  async function requireAccess() {
    const account = await bootstrap();
    const { currentLevel } = await createMfaService(supabaseClient).assurance();
    if (!account.access_allowed || (account.mfa_required && currentLevel !== "aal2")) {
      location.replace("mfa.html");
      return null;
    }
    return account;
  }
  return { bootstrap, destination, routeAfterPassword, requireAccess };
})();
