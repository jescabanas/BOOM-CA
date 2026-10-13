// Shared MOV preview. The submission view stays fixed; only this preview pane
// scrolls when a PDF or image is larger than the available space.
(() => {
  const previewable = (name = "") => /\.(pdf|png|jpe?g|gif|webp)$/i.test(name);
  const image = (name = "") => /\.(png|jpe?g|gif|webp)$/i.test(name);

  window.openDocumentPreview = (url, name, options = {}) => {
    if (!url) return;
    document.querySelector("#document-preview-modal .document-preview-close")?.click();
    const modal = document.createElement("div");
    modal.id = "document-preview-modal";
    modal.className = "document-preview-modal";
    modal.innerHTML = `
      <section class="document-preview-card" role="dialog" aria-modal="true" aria-label="Document preview">
        <header class="document-preview-header"><strong class="document-preview-title"></strong><div class="document-preview-actions"><button type="button" class="btn btn-outline btn-small document-preview-download">Download</button><button type="button" class="btn btn-outline dialog-close document-preview-close" aria-label="Close document preview">×</button></div></header>
        <div class="document-preview-body"></div>
      </section>`;
    let previewUrl = null;
    const close = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      options.onClose?.();
      modal.remove();
    };
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    modal.querySelector(".document-preview-close").addEventListener("click", close);
    modal.querySelector(".document-preview-title").textContent = name || "Document preview";
    const download = modal.querySelector(".document-preview-download");
    download.addEventListener("click", async () => {
      const originalLabel = download.textContent;
      download.disabled = true;
      download.textContent = "Downloading…";
      try {
        let file;
        if (options.download) file = await options.download();
        else {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Download failed");
          file = await response.blob();
        }
        const fileUrl = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = name || "MOV-document";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(fileUrl);
      } catch {
        download.textContent = "Download failed";
        setTimeout(() => { download.textContent = originalLabel; }, 1800);
      } finally {
        download.disabled = false;
      }
    });
    const body = modal.querySelector(".document-preview-body");
    if (previewable(name)) {
      const loading = document.createElement("p");
      loading.className = "document-preview-unavailable";
      loading.textContent = "Loading preview…";
      body.appendChild(loading);
      (async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Preview failed");
          const file = await response.blob();
          const previewFile = image(name) ? file : new Blob([file], { type: "application/pdf" });
          previewUrl = URL.createObjectURL(previewFile);
          if (!modal.isConnected) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
            return;
          }
          const element = document.createElement(image(name) ? "img" : "iframe");
          element.src = previewUrl;
          element.title = name || "MOV document";
          if (image(name)) element.alt = name || "MOV document";
          body.replaceChildren(element);
        } catch {
          if (modal.isConnected) {
            loading.textContent = "This document cannot be previewed here. You can still download it.";
          }
        }
      })();
    } else {
      const message = document.createElement("p");
      message.className = "document-preview-unavailable";
      message.textContent = "This file type cannot be previewed in the browser. Use Download to open it with the appropriate application.";
      body.appendChild(message);
    }
    document.body.appendChild(modal);
    if (typeof initializeDialog === "function") initializeDialog(modal, modal.querySelector(".document-preview-close"), { observe: false, backdrop: false });
  };
})();
