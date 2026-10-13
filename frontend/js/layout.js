// Shared role-aware sidebar navigation.
const NAV_BY_ROLE = {
  super_admin: [
    { href: "admin.html", label: "Admin Consoles" },
    { href: "deadlines.html", label: "Compliance Deadlines" },
    { href: "dashboard.html", label: "Analytics" },
    { href: "evaluator.html", label: "Review" },
    { href: "rankings.html", label: "Rankings" },
    { href: "history.html", label: "History" },
  ],
  barangay_secretary: [
    { href: "secretary.html", label: "My Submissions" },
    { href: "barangay-analytics.html", label: "Analytics" },
    { href: "rankings.html", label: "Rankings" },
    { href: "history.html", label: "History" },
  ],
};
function renderSidebar(activePage, role) {
  const mount = document.getElementById("sidebar-nav");
  if (!mount) return;
  mount.innerHTML = (NAV_BY_ROLE[role] || [])
    .map(
      (item) => `
    <a href="${item.href}" class="${item.href === activePage ? "active" : ""}">${item.label}</a>`,
    )
    .join("");
  const footer = document.querySelector(".sidebar-footer");
  if (footer) footer.innerHTML = '<button type="button" class="sidebar-logout" onclick="logout()">Log out</button>';
}
