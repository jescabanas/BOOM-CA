// Theme preferences apply only to explicitly marked internal system pages.
// Public pages stay light without erasing the user's system preference.
function isSystemThemePage() {
  return document.documentElement.getAttribute("data-theme-scope") === "system";
}

(function () {
  if (!isSystemThemePage()) {
    document.documentElement.removeAttribute("data-theme");
    return;
  }
  const STORAGE_KEY = "bcs-theme";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark") document.documentElement.setAttribute("data-theme", "dark");
  } catch { /* The page still works when browser storage is unavailable. */ }
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.newValue === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    document.dispatchEvent(new CustomEvent("bcs-theme-change"));
  });
})();

function initThemeToggle(mountId) {
  if (!isSystemThemePage()) return;
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const STORAGE_KEY = "bcs-theme";
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  mount.innerHTML = `
    <button type="button" class="theme-toggle" id="theme-toggle-btn" aria-label="Toggle dark mode" aria-pressed="${isDark}">
      <span class="theme-toggle-label">Appearance</span>
      <span class="theme-toggle-icon theme-toggle-sun" aria-hidden="true">☀</span>
      <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
      <span class="theme-toggle-icon theme-toggle-moon" aria-hidden="true">☾</span>
    </button>`;
  const btn = document.getElementById("theme-toggle-btn");
  const sync = () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    btn.setAttribute("aria-pressed", dark);
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.querySelector(".theme-toggle-label").textContent = dark ? "Dark mode" : "Light mode";
    btn.classList.toggle("is-dark", dark);
  };
  sync();
  document.addEventListener("bcs-theme-change", sync);
  btn.addEventListener("click", toggleTheme);
}

function toggleTheme() {
  if (!isSystemThemePage()) return;
  const STORAGE_KEY = "bcs-theme";
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  if (dark) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", "dark");
  try { localStorage.setItem(STORAGE_KEY, dark ? "light" : "dark"); } catch { /* Keep the in-page toggle usable. */ }
  document.dispatchEvent(new CustomEvent("bcs-theme-change"));
}
