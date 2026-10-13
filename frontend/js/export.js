// export.js
// Client-side export helpers. CSV/Excel use SheetJS; PDF uses jsPDF + autotable.
// Ranking pages load PDF libraries on demand so exports don't delay their data.

let pdfLibrariesPromise;
function loadPDFLibraries() {
  if (pdfLibrariesPromise) return pdfLibrariesPromise;
  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error('PDF library could not be loaded.'));
    };
    document.head.appendChild(script);
  });
  pdfLibrariesPromise = (async () => {
    if (!window.jspdf?.jsPDF) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    }
    if (!window.jspdf?.jsPDF) throw new Error('PDF library is unavailable.');
    if (!window.jspdf.jsPDF.API.autoTable) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.1/dist/jspdf.plugin.autotable.min.js');
    }
    if (!window.jspdf.jsPDF.API.autoTable) throw new Error('PDF table library is unavailable.');
  })().catch(error => {
    pdfLibrariesPromise = null;
    throw error;
  });
  return pdfLibrariesPromise;
}

function exportToCSV(filename, rows) {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  downloadBlob(csv, filename.endsWith(".csv") ? filename : `${filename}.csv`, "text/csv");
}

function exportToExcel(filename, rows, sheetName = "Report") {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function exportToPDF(filename, title, rows) {
  if (!rows.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22);

  const headers = [Object.keys(rows[0])];
  const body = rows.map((r) => Object.values(r).map((v) => String(v ?? "")));

  doc.autoTable({
    head: headers,
    body,
    startY: 28,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [19, 49, 92] }, // navy
  });

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Calls the generate-report Edge Function for server-side, audit-logged
 * exports (used by staff roles for official reports).
 */
async function requestServerReport(reportType, filters = {}) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ report_type: reportType, filters }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Report generation failed");
  }
  const csv = await res.text();
  downloadBlob(csv, `${reportType}.csv`, "text/csv");
}
