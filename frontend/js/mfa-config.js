// UI routing only. The database policy is the authority for required roles.
window.MFA_CONFIG = Object.freeze({
  requiredRoles: ["super_admin", "barangay_secretary"],
  destinations: { super_admin: "dashboard.html", barangay_secretary: "secretary.html" },
  ...window.__MFA_CONFIG__,
});
