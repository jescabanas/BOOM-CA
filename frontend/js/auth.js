// auth.js
// Shared authentication helpers used across every protected page.

async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // Private writes happen only after the MFA/session gate succeeds.
  return data;
}

let logoutConfirmation = null;
function confirmLogout() {
  if (logoutConfirmation) return logoutConfirmation;
  const opener = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "logout-dialog";
  dialog.setAttribute("aria-labelledby", "logout-dialog-title");
  dialog.setAttribute("aria-describedby", "logout-dialog-description");
  dialog.innerHTML = `<button type="button" class="btn btn-outline logout-dialog-close" aria-label="Cancel logout">×</button>
    <div class="logout-dialog-icon" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H5v14h4M13 8l4 4-4 4M9 12h12"/></svg></div>
    <div class="eyebrow">DILG Lucena · Account session</div>
    <h2 id="logout-dialog-title">Log out of your account?</h2>
    <p id="logout-dialog-description">Are you sure you want to log out? You will need to sign in again to continue.</p>
    <div class="logout-dialog-actions"><button type="button" class="btn btn-outline" data-stay autofocus>Stay signed in</button><button type="button" class="btn btn-primary" data-logout>Yes, log out</button></div>`;
  logoutConfirmation = new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      dialog.remove(); logoutConfirmation = null;
      if (opener?.isConnected) opener.focus({preventScroll:true});
      resolve(confirmed);
    }, {once:true});
  });
  dialog.querySelector(".logout-dialog-close").onclick = () => dialog.close("cancel");
  dialog.querySelector("[data-stay]").onclick = () => dialog.close("cancel");
  dialog.querySelector("[data-logout]").onclick = () => dialog.close("confirm");
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close("cancel");
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  return logoutConfirmation;
}

let logoutInProgress = false;
function showAdminForm(title, fields, description = "Update the details below.", identity = null) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "logout-dialog admin-edit-dialog";
    dialog.innerHTML = `<button type="button" class="btn btn-outline logout-dialog-close" aria-label="Cancel editing">×</button><div class="logout-dialog-icon" aria-hidden="true">✎</div><div class="eyebrow">DILG Lucena · Administration</div><h2 id="admin-edit-title"></h2><p id="admin-edit-description"></p><form><div data-fields></div><div class="logout-dialog-actions"><button type="button" class="btn btn-outline" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save changes</button></div></form>`;
    dialog.setAttribute("aria-labelledby","admin-edit-title");
    dialog.setAttribute("aria-describedby","admin-edit-description");
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector("p").textContent = description;
    if (identity) {
      const details = dialog.querySelector("#admin-edit-description");
      details.className = "admin-edit-identity";
      details.textContent = "";
      const name = document.createElement("strong");
      name.className = "admin-edit-name";
      name.textContent = identity.name || "";
      const email = document.createElement("span");
      email.className = "admin-edit-email";
      email.textContent = identity.email || "";
      details.append(name, email);
    }
    const controls = {};
    const mount = dialog.querySelector("[data-fields]");
    for (const field of fields) {
      const wrapper = document.createElement("div"); wrapper.className = "field";
      const label = document.createElement("label"); label.textContent = field.label;
      const control = document.createElement(field.options ? "select" : field.type === "textarea" ? "textarea" : "input");
      control.id = "admin-edit-" + field.name; label.htmlFor = control.id;
      if (field.options) for (const option of field.options) { const el=document.createElement("option"); el.value=option.value; el.textContent=option.label; control.appendChild(el); }
      else if (field.type !== "textarea") control.type = field.type || "text";
      control.value = String(field.value ?? ""); control.required = !!field.required; control.disabled = !!field.disabled;
      for (const key of ["min","max","step","maxLength","minLength"]) if (field[key] !== undefined) control[key]=field[key];
      wrapper.append(label,control); mount.appendChild(wrapper); controls[field.name]={control,wrapper,field};
    }
    const sync = () => { for (const item of Object.values(controls)) { const visible = !item.field.when || item.field.when(controls); item.wrapper.hidden=!visible; item.control.disabled=!!item.field.disabled || !visible; } };
    mount.addEventListener("change",sync); sync();
    let result = null;
    dialog.querySelector("form").onsubmit = event => { event.preventDefault(); if (!event.target.reportValidity()) return; result=Object.fromEntries(Object.entries(controls).map(([key,item])=>[key,item.control.value])); dialog.close(); };
    dialog.querySelector("[data-cancel]").onclick = dialog.querySelector(".logout-dialog-close").onclick = () => dialog.close();
    dialog.addEventListener("close", () => { dialog.remove(); if (opener?.isConnected) opener.focus({preventScroll:true}); resolve(result); }, {once:true});
    document.body.appendChild(dialog); dialog.showModal();
    Object.values(controls).find(item=>!item.control.disabled)?.control.focus();
  });
}
async function logout() {
  if (logoutInProgress) return;
  logoutInProgress = true;
  try {
  if (!(await confirmLogout())) return;
  const { data: userData } = await supabaseClient.auth.getUser();
  if (userData?.user) {
    await supabaseClient.rpc("log_audit_event", {
      p_user_id: userData.user.id,
      p_action: "LOGOUT",
      p_entity_table: "profiles",
      p_entity_id: userData.user.id,
      p_metadata: {},
    });
  }
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
  } finally { logoutInProgress = false; }
}

async function requestPasswordReset(email) {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), {
    // Keep the frontend directory when testing in a Live Server subfolder.
    redirectTo: new URL("reset-password.html", window.location.href).href,
  });
  if (error) throw error;
}

/**
 * Call at the top of every protected page.
 * allowedRoles: array of role strings permitted on this page.
 * Redirects to index.html if not authenticated, or to the user's own
 * home page if authenticated but not permitted here.
 */
async function guardPage(allowedRoles) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData?.session) {
    window.location.href = "index.html";
    return null;
  }

  try {
    if (!(await MfaSession.requireAccess())) return null;
  } catch (error) {
    // Fail closed when security configuration is unavailable.
    document.body.textContent = error.message;
    return null;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*, barangays(name)")
    .eq("id", sessionData.session.user.id)
    .single();

  if (error || !profile || !profile.is_active) {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    window.location.href = ROLE_HOME[profile.role] || "index.html";
    return null;
  }

  renderUserChip(profile);
  return profile;
}

function renderUserChip(profile) {
  const chip = document.getElementById("user-chip");
  if (!chip) return;
  const initials = profile.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const avatar = profile.avatar_url
    ? `<img class="avatar" src="${profile.avatar_url}" alt="Profile picture" />`
    : `<div class="avatar">${escapeProfile(initials)}</div>`;
  chip.innerHTML = `<button type="button" class="profile-trigger" aria-label="Open profile settings">
    ${avatar}
    <div>
      <div style="font-size:14px;font-weight:600;">${escapeProfile(profile.full_name)}</div>
      <div class="role-tag">${ROLE_LABEL[profile.role] || profile.role}</div>
    </div>
  </button>`;
  chip.querySelector(".profile-trigger").addEventListener("click", () => openProfileMenu(profile));
}

function openProfileMenu(profile) {
  document.getElementById("profile-modal")?.remove();
  const barangay = profile.barangays?.name || "Assigned automatically";
  const initials = profile.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const modal = document.createElement("div");
  modal.id = "profile-modal";
  modal.className = "profile-modal-backdrop";
  modal.innerHTML = `<section class="card profile-modal profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-heading">
    <div class="dialog-heading"><div><div class="eyebrow">Account settings</div><h3 id="profile-heading">Edit profile</h3><p class="dialog-description">Keep your personal details and photo up to date.</p></div><button type="button" class="btn btn-outline dialog-close" data-close aria-label="Close profile settings">×</button></div>
    <div class="profile-identity">
      <button type="button" class="profile-avatar-trigger" id="profile-avatar-trigger" aria-label="Change profile picture">
        ${profile.avatar_url ? `<img src="${profile.avatar_url}" alt="Profile picture" />` : `<span>${initials}</span>`}
      </button>
      <input type="file" id="profile-avatar-file" accept="image/png,image/jpeg,image/webp" style="display:none;" />
      <div style="flex:1;">
        <div style="font-weight:700;font-size:15px;">${escapeProfile(profile.full_name)}</div>
        <div style="font-size:12.5px;color:var(--color-ink-600);">${ROLE_LABEL[profile.role] || profile.role}</div>
        <div class="profile-photo-actions"><button type="button" id="profile-avatar-change" class="btn btn-outline">Change photo</button>${profile.avatar_url ? `<button type="button" id="profile-avatar-remove" class="btn btn-outline">Remove photo</button>` : ""}</div><small>PNG, JPG or WebP · up to 5 MB</small>
      </div>
    </div>
    <h4 class="profile-section-title">Personal details</h4>
    <div class="field"><label for="profile-name">Full name</label><input id="profile-name" autocomplete="name" value="${escapeProfile(profile.full_name)}" /></div>
    <div class="field"><label for="profile-phone">Cellphone number</label><input id="profile-phone" autocomplete="tel" type="tel" value="${escapeProfile(profile.phone || "")}" /></div>
    <section class="dialog-section"><h4>Account information</h4><p class="field-hint">These details are managed by your administrator.</p>
    <div class="field"><label for="profile-email">Email</label><input id="profile-email" value="${escapeProfile(profile.email)}" disabled /></div>
    <div class="field"><label for="profile-role">Role</label><input id="profile-role" value="${escapeProfile(ROLE_LABEL[profile.role] || profile.role)}" disabled /></div>
    ${profile.role === "barangay_secretary" ? `<div class="field"><label for="profile-barangay">Barangay</label><input id="profile-barangay" value="${escapeProfile(barangay)}" disabled /></div>` : ""}</section>
    <a class="btn btn-outline" href="mfa.html?manage=1">Manage authenticator</a>
    <div class="dialog-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" id="profile-save">Save changes</button></div>
  </section>`;
  document.body.appendChild(modal);
  initializeDialog(modal, modal.querySelector("[data-close]"), { observe: false, backdrop: false });
  modal.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => modal.remove()));
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });

  let pendingAvatarUrl = profile.avatar_url || null;
  const fileInput = modal.querySelector("#profile-avatar-file");
  const choosePhoto = () => {
    // Allow choosing the same photo again after a failed upload.
    fileInput.value = "";
    fileInput.click();
  };
  modal.querySelector("#profile-avatar-trigger").addEventListener("click", choosePhoto);
  modal.querySelector("#profile-avatar-change").addEventListener("click", choosePhoto);
  modal.querySelector("#profile-avatar-remove")?.addEventListener("click", () => {
    pendingAvatarUrl = null;
    const trigger = modal.querySelector("#profile-avatar-trigger");
    trigger.innerHTML = `<span>${initials}</span>`;
    modal.querySelector("#profile-avatar-remove")?.remove();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return showToast("Profile picture must be under 5 MB.");
    const trigger = modal.querySelector("#profile-avatar-trigger");
    trigger.style.opacity = "0.6";
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${profile.id}/${Date.now()}.${ext}`;
    // The timestamped path is always new. Avoiding upsert prevents Storage
    // from performing an UPDATE/SELECT RLS check that a simple new upload
    // does not require.
    const { error: uploadError } = await supabaseClient.storage.from("avatars").upload(path, file, { contentType: file.type });
    trigger.style.opacity = "1";
    if (uploadError) {
      console.error("Avatar upload failed:", uploadError);
      const needsAvatarRepair = /row-level security|not authorized|access denied/i.test(uploadError.message);
      return showToast(needsAvatarRepair
        ? "Profile-photo storage is blocked. Run migration 0022_avatar_storage_repair.sql in Supabase, then try again."
        : uploadError.message.includes("Bucket not found")
          ? "Run migration 0022_avatar_storage_repair.sql before uploading a profile picture."
          : uploadError.message);
    }
    const { data: publicUrlData } = supabaseClient.storage.from("avatars").getPublicUrl(path);
    pendingAvatarUrl = publicUrlData.publicUrl;
    trigger.innerHTML = `<img src="${pendingAvatarUrl}" alt="Profile picture" />`;
  });

  modal.querySelector("#profile-save").addEventListener("click", async () => {
    const full_name = modal.querySelector("#profile-name").value.trim(), phone = modal.querySelector("#profile-phone").value.trim() || null;
    if (!full_name) return showToast("Your name is required.");
    const { error } = await supabaseClient.from("profiles").update({ full_name, phone, avatar_url: pendingAvatarUrl }).eq("id", profile.id);
    if (error) return showToast(error.message.includes("avatar_url") ? "Run migration 0014 before saving a profile picture." : error.message);
    profile.full_name = full_name; profile.phone = phone; profile.avatar_url = pendingAvatarUrl; renderUserChip(profile); modal.remove(); document.querySelector(".profile-trigger")?.focus({ preventScroll: true }); showToast("Profile updated.");
  });
}

function escapeProfile(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]); }

// Keep keyboard focus inside an open dialog and return it to its opener.
// Existing save, cancel and preview/download handlers remain unchanged.
function initializeDialog(root, closeButton, { observe = true, backdrop = true } = {}) {
  if (!root || !closeButton) return;
  let wasOpen = false, opener;
  const isOpen = () => root.isConnected && getComputedStyle(root).display !== "none";
  const sync = () => {
    const open = isOpen();
    if (open && !wasOpen) { opener = document.activeElement; closeButton.focus({ preventScroll: true }); }
    if (!open && wasOpen && opener?.isConnected) opener.focus({ preventScroll: true });
    wasOpen = open;
  };
  if (observe) new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["style"] });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeButton.click(); }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
      .filter(element => !element.disabled && element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  if (backdrop) root.addEventListener("click", event => { if (event.target === root) closeButton.click(); });
  root.addEventListener("click", () => queueMicrotask(sync));
  sync();
}

document.addEventListener("DOMContentLoaded", () => {
  for (const [id, closeId] of [["deadline-modal", "close-btn"], ["submission-modal", "cancel-submission"], ["review-modal", "cancel-review"], ["history-modal", "close-history-modal"], ["compliance-modal", "cancel-compliance"], ["user-modal", "cancel-user"]]) {
    initializeDialog(document.getElementById(id), document.getElementById(closeId));
  }
});

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
