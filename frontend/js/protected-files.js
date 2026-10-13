// Private files are fetched with the current session JWT, not transferable
// signed URLs. Storage RLS checks MFA + ownership on every remote fetch.
window.ProtectedFiles = (() => {
  const urls = new Set();
  async function download(bucket, path) {
    if (!["mov-documents", "account-application-proofs"].includes(bucket)) throw new Error("Invalid private document bucket.");
    if (!(await MfaSession.requireAccess())) throw new Error("Verify your authenticator before opening this document.");
    const { data, error } = await supabaseClient.storage.from(bucket).download(path);
    if (error || !data) throw new Error("This private document could not be loaded. Check your access and retry.");
    return data;
  }
  function release(url) { URL.revokeObjectURL(url); urls.delete(url); }
  function objectUrl(blob) { const url = URL.createObjectURL(blob); urls.add(url); return url; }
  window.addEventListener("pagehide", () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });
  return { download, objectUrl, release };
})();
window.openProtectedDocument = async (path, name) => {
  try {
    const file = await ProtectedFiles.download("mov-documents", path);
    const url = ProtectedFiles.objectUrl(file);
    openDocumentPreview(url, name, {
      onClose: () => ProtectedFiles.release(url),
      download: () => ProtectedFiles.download("mov-documents", path),
    });
  } catch (error) { if (typeof showToast === "function") showToast(error.message); }
};
