// Read-only analytics exploration. The source charts remain untouched.
function initDashboardChartExplorer(getSnapshot) {
  const titles = { mandate: "Compliance by Mandate", breakdown: "Compliance Breakdown", trend: "Submission Trends" };
  const labels = ["COMPLIANT", "PENDING", "LATE", "REJECTED"];
  const bands = ["on_time", "grace_period", "late"];
  const bandLabels = ["ADVANCED", "ON-TIME", "LATE"];
  const escapeText = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  const dateKey = (value, granularity) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return granularity === "day" ? `${parts.year}-${parts.month}-${parts.day}` : `${parts.year}-${parts.month}`;
  };
  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not submitted" : date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  };
  let dialog, snapshot, kind, opener, previousOverflow, selectedBand = 0, selectedDate = "", selectedSlice = 0, selectedMandate = null, requestVersion = 0;
  const canvasId = "expanded-dashboard-chart";
  const details = () => dialog.querySelector(".chart-explorer-details");
  const options = () => dialog.querySelector(".chart-explorer-options");
  const counts = () => [snapshot.cards.compliant_barangays, snapshot.cards.pending_submissions, snapshot.cards.late_submissions, snapshot.cards.rejected_submissions];
  function renderDetails(title, description, rows, { unique = false, tone = "success" } = {}) {
    const visibleRows = unique ? [...new Map(rows.map(row => [row.barangay_id, row])).values()] : rows;
    details().innerHTML = `<h3>${escapeText(title)}</h3><p>${escapeText(description)}</p><div class="chart-detail-list">${visibleRows.length ? visibleRows.map(row => `<div class="chart-detail-item"><strong class="chart-name-${tone}">${escapeText(row.barangay_name)}</strong>${row.status ? `<small>${escapeText(row.compliance_periods?.title || "Compliance submission")} · ${escapeText(row.compliance_periods?.period_label || "")}</small><small>${escapeText(row.status.replaceAll("_", " ").toUpperCase())} · ${escapeText(bandLabels[bands.indexOf(row.score_band)] || "NOT SCORED")} · ${escapeText(formatDate(row.last_submitted_at || row.submitted_at))}</small>` : ""}</div>`).join("") : '<p class="chart-empty">No matching barangays or submissions for this selection.</p>'}</div>`;
  }
  function selectSlice(index) {
    selectedSlice = index;
    const filters = [row => row.status === "approved", row => row.status === "under_review", row => row.score_band === "late", row => row.status === "rejected"];
    const rows = snapshot.rows.filter(filters[index]);
    renderDetails(labels[index], `${counts()[index] || 0} ${index === 0 ? "distinct compliant barangays" : "submissions"} in the selected analytics period.`, rows, { unique: index === 0, tone: ["success", "warning", "danger", "danger"][index] });
    options().querySelectorAll("button").forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  }
  function selectTrend(row, index = selectedBand) {
    selectedBand = index;
    if (row) selectedDate = dateKey(row.month, snapshot.granularity);
    const matching = snapshot.rows.filter(item => item.score_band === bands[selectedBand] && (!selectedDate || dateKey(item.last_submitted_at || item.submitted_at, snapshot.granularity) === selectedDate));
    renderDetails(bandLabels[selectedBand], `${matching.length} submissions · ${selectedDate || "All dates in the selected analytics period"}.`, matching, { tone: ["success", "warning", "danger"][selectedBand] });
    options().querySelectorAll("button").forEach((button, i) => button.setAttribute("aria-pressed", String(i === selectedBand)));
    options().querySelector("select").value = selectedDate;
  }
  async function selectMandate(row) {
    selectedMandate = row;
    const version = ++requestVersion;
    options().querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mandate === row.mandate_id)));
    details().innerHTML = `<h3>${escapeText(row.title)}</h3><p>Loading compliant barangays…</p>`;
    try {
      const { data, error } = await supabaseClient.rpc("analytics_period_barangays_for_mandate", { p_mandate_id: row.mandate_id, ...analyticsPeriodArgs(snapshot.period) });
      if (!dialog?.open || version !== requestVersion) return;
      if (error) throw error;
      const names = Array.isArray(data) ? data : [];
      renderDetails(row.title, `${names.length} of ${row.total_barangays} active barangays complied in this analytics period.`, names);
    } catch {
      if (!dialog?.open || version !== requestVersion) return;
      details().innerHTML = `<h3>${escapeText(row.title)}</h3><p>Could not load the barangay list.</p><button type="button" class="btn btn-outline" data-retry>Try again</button>`;
      details().querySelector("[data-retry]").addEventListener("click", () => selectMandate(row));
    }
  }
  function renderChart() {
    if (kind === "breakdown") renderCompliancePieChart(canvasId, snapshot.cards, selectSlice);
    if (kind === "trend") renderSubmissionTrendsChart(canvasId, snapshot.trends, snapshot.granularity, selectTrend);
    if (kind === "mandate") renderMandateComplianceChart(canvasId, snapshot.mandates, selectMandate);
  }
  function open(type, trigger) {
    if (!getSnapshot().cards) return;
    close();
    snapshot = getSnapshot(); kind = type; opener = trigger;
    selectedBand = 0; selectedDate = ""; selectedSlice = 0; selectedMandate = null;
    dialog = document.createElement("dialog");
    dialog.className = "chart-explorer";
    dialog.setAttribute("aria-labelledby", "chart-explorer-title");
    dialog.innerHTML = `<header class="chart-explorer-header"><div><div class="eyebrow">Analytics explorer · ${escapeText(snapshot.period.mode)} period</div><h2 id="chart-explorer-title">${titles[kind]}</h2><p>Click the chart or use the controls below to explore the details alongside it.</p></div><button type="button" class="btn btn-outline dialog-close" aria-label="Close expanded chart">×</button></header><div class="chart-explorer-content"><section class="chart-explorer-plot"><div class="chart-explorer-canvas"><canvas id="${canvasId}" role="img" aria-label="${titles[kind]}. Use the buttons below for the same statistics."></canvas></div><div class="chart-explorer-options" aria-label="Chart detail filters"></div></section><aside class="chart-explorer-details" aria-live="polite"></aside></div>`;
    document.body.appendChild(dialog);
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector(".dialog-close").addEventListener("click", close);
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll('button, select, input, a[href], [tabindex="0"]')].filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    dialog.showModal(); renderChart();
    if (kind === "breakdown") {
      options().innerHTML = labels.map((label, index) => `<button type="button" class="btn btn-outline" aria-pressed="false" data-index="${index}">${label} · ${counts()[index] || 0}</button>`).join("") + '<p class="chart-kicker">Compliant counts distinct barangays; other categories count submissions and may overlap.</p>';
      options().querySelectorAll("button").forEach(button => button.addEventListener("click", () => selectSlice(Number(button.dataset.index))));
      selectSlice(counts().findIndex(count => count > 0) < 0 ? 0 : counts().findIndex(count => count > 0));
    }
    if (kind === "trend") {
      const dates = [...new Set(snapshot.trends.map(row => dateKey(row.month, snapshot.granularity)))];
      options().innerHTML = bandLabels.map((label, index) => `<button type="button" class="btn btn-outline" data-index="${index}" aria-pressed="false">${label}</button>`).join("") + `<label>Submission date<select aria-label="Filter submission date"><option value="">All dates</option>${dates.map(date => `<option value="${date}">${date}</option>`).join("")}</select></label>`;
      options().querySelectorAll("button").forEach(button => button.addEventListener("click", () => selectTrend(null, Number(button.dataset.index))));
      options().querySelector("select").addEventListener("change", event => { selectedDate = event.target.value; selectTrend(null); });
      selectTrend(null, 0);
    }
    if (kind === "mandate") {
      options().innerHTML = snapshot.mandates.map(row => `<button type="button" class="btn btn-outline" data-mandate="${escapeText(row.mandate_id)}" aria-pressed="false">${escapeText(row.title)} · ${Number(row.compliant_barangays) || 0}</button>`).join("");
      options().querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => selectMandate(snapshot.mandates[index])));
      if (snapshot.mandates.length) selectMandate(snapshot.mandates[0]);
      else renderDetails("No mandates available", "No mandate data is available for this analytics period.", []);
    }
    dialog.querySelector(".dialog-close").focus({ preventScroll: true });
  }
  function close() {
    if (!dialog) return;
    requestVersion++;
    destroyDashboardChart(canvasId);
    dialog.close(); dialog.remove(); dialog = null;
    document.body.style.overflow = previousOverflow;
    opener?.focus({ preventScroll: true });
  }
  document.querySelectorAll("[data-expand-chart]").forEach(button => button.addEventListener("click", () => open(button.dataset.expandChart, button)));
  document.addEventListener("bcs-theme-change", () => { if (dialog?.open) renderChart(); });
  return { close };
}
