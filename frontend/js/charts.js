// charts.js
// Chart.js instances for the director dashboard. Uses the design system's
// navy/gold palette so charts feel native to the rest of the UI rather than
// Chart.js defaults.

const CHART_COLORS = {
  navy: "#F8D7A1",
  gold: "#F5BE42",
  success: "#35D39E",
  warning: "#F59E42",
  danger: "#F15B6C",
  grid: "rgba(255, 230, 232, 0.18)",
  text: "#F7DDE0",
  tooltip: "#4B0811",
};

const DARK_CHART_DEFAULTS = {
  color: CHART_COLORS.text,
  font: { family: "Inter", size: 12 },
};

function getChartColors() {
  if (document.documentElement.getAttribute("data-theme") === "dark") return CHART_COLORS;
  return {
    navy: "#A51F31",
    gold: "#C57A10",
    success: "#187A55",
    warning: "#B45A16",
    danger: "#BE2740",
    grid: "rgba(111, 43, 45, 0.16)",
    text: "#6C3032",
    tooltip: "#5B171F",
  };
}

// Filters v_submission_trends rows (each has a `month` date) down to a
// selected period for the "Filter analytics period" dropdown on the
// dashboard. Returns a new array; does not mutate the input.
function filterTrendRowsByPeriod(trendRows, period) {
  if (!trendRows || period === "all") return trendRows;
  const now = new Date();
  return trendRows.filter((r) => {
    const d = new Date(r.month);
    if (period === "this_year") return d.getFullYear() === now.getFullYear();
    if (period === "last_year") return d.getFullYear() === now.getFullYear() - 1;
    if (period === "last_6_months") {
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      return d >= cutoff;
    }
    if (period === "last_12_months") {
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      return d >= cutoff;
    }
    return true;
  });
}

// A separate instance per canvas keeps expanded charts from destroying previews.
const dashboardCharts = new Map();
function destroyDashboardChart(canvasId) {
  dashboardCharts.get(canvasId)?.destroy();
  dashboardCharts.delete(canvasId);
}

// When statuses have the same count on the same day, Chart.js draws them at
// precisely the same point. Use centered, complete color rings to show each
// overlapping status without moving a marker away from its data point.
const overlappingStatusHighlight = {
  id: "overlappingStatusHighlight",
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== "trend-chart") return;
    const datasets = chart.data.datasets;
    const pointSets = [0, 1, 2].map((datasetIndex) => chart.getDatasetMeta(datasetIndex)?.data || []);
    for (let index = 0; index < pointSets[0].length; index += 1) {
      const advanced = Number(datasets[0]?.data[index]) || 0;
      const onTime = Number(datasets[1]?.data[index]) || 0;
      const late = Number(datasets[2]?.data[index]) || 0;
      const statuses = [advanced, onTime, late];
      const overlapping = statuses.filter((value) => value > 0 && statuses.filter((other) => other === value).length > 1);
      if (overlapping.length < 2) continue;
      const pointDatasetIndex = statuses.findIndex(
        (value, datasetIndex) => value > 0 && statuses.some((other, otherIndex) => otherIndex !== datasetIndex && other === value),
      );
      const point = pointSets[pointDatasetIndex]?.[index];
      if (!point) continue;

      const drawHighlight = (datasetIndex, radius) => {
        if (!statuses[datasetIndex] || !statuses.some((other, otherIndex) => otherIndex !== datasetIndex && other === statuses[datasetIndex])) return;
        chart.ctx.beginPath();
        chart.ctx.strokeStyle = datasets[datasetIndex].borderColor;
        chart.ctx.lineWidth = 3;
        chart.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        chart.ctx.stroke();
      };

      chart.ctx.save();
      // Only Late needs an extra visual treatment: the normal point already
      // represents Advanced/On-time. Keep the red ring tight to that point.
      drawHighlight(2, 5);
      chart.ctx.restore();
    }
  },
};

// Creates a continuous monthly series. PostgreSQL only returns months that
// have submissions, which otherwise makes a trend line jump across gaps —
// or, with only one month of data, renders as a single unconnected dot
// since a line needs at least two points to draw anything. Padding to a
// minimum window guarantees there's always a line to see.
function fillMissingTrendMonths(trendRows, minMonths = 6) {
  if (!trendRows?.length) return [];

  const rowsByMonth = new Map(
    trendRows.map((row) => {
      const date = new Date(row.month);
      return [new Date(date.getFullYear(), date.getMonth(), 1).getTime(), row];
    }),
  );
  const dates = [...rowsByMonth.keys()].sort((a, b) => a - b);
  const end = new Date(dates[dates.length - 1]);

  const paddedStart = new Date(end);
  paddedStart.setMonth(paddedStart.getMonth() - (minMonths - 1));
  const start = new Date(Math.min(dates[0], paddedStart.getTime()));

  const result = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const key = cursor.getTime();
    result.push(rowsByMonth.get(key) ?? {
      month: new Date(key).toISOString(),
      on_time_count: 0,
      grace_count: 0,
      late_count: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

function renderSubmissionTrendsChart(canvasId, trendRows, granularity = "month", onPointClick, completePeriod = false) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  destroyDashboardChart(canvasId);
  // Day-mode data arrives already complete (every date of the selected
  // month, filled by dashboard.html's buildTrends) so it skips the
  // month-oriented gap-filling below, which would misinterpret daily
  // timestamps as monthly cursors.
  const rows = granularity === "day" || completePeriod ? (trendRows || []) : fillMissingTrendMonths(trendRows);
  const colors = getChartColors();
  const formatLabel = granularity === "day"
    ? (r) => new Date(r.month).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : (r) => new Date(r.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  // Day view has up to 31 points on screen at once, so thinner lines and
  // smaller markers read as a clean trend instead of a cluttered zigzag.
  const lineWidth = granularity === "day" ? 1.5 : 2.5;
  const pointR = granularity === "day" ? 2.5 : 5;
  // Keep regular and hover markers identical. This avoids creating a
  // second, dark-red-looking layer when several statuses share a date.
  const pointHoverR = pointR;

  const chart = new Chart(ctx, {
    type: "line",
    plugins: [overlappingStatusHighlight],
    data: {
      labels: rows.map(formatLabel),
      datasets: [
        {
          label: "ADVANCED",
          data: rows.map((r) => Number(r.on_time_count) || 0),
          borderColor: colors.success,
          backgroundColor: colors.success,
          borderWidth: lineWidth,
          tension: 0.3,
          pointRadius: pointR,
          pointHoverRadius: pointHoverR,
          pointHoverBackgroundColor: colors.success,
          pointBorderColor: colors.success,
          pointBorderWidth: 0,
          pointHoverBorderWidth: 0,
          order: 1,
        },
        {
          label: "ON-TIME",
          data: rows.map((r) => Number(r.grace_count) || 0),
          borderColor: colors.gold,
          backgroundColor: colors.gold,
          borderWidth: lineWidth,
          tension: 0.3,
          pointRadius: pointR,
          pointHoverRadius: pointHoverR,
          pointHoverBackgroundColor: colors.gold,
          pointBorderColor: colors.gold,
          pointBorderWidth: 0,
          pointHoverBorderWidth: 0,
          order: 2,
        },
        {
          label: "LATE",
          data: rows.map((r) => Number(r.late_count) || 0),
          borderColor: colors.danger,
          backgroundColor: colors.danger,
          borderWidth: lineWidth,
          tension: 0.3,
          pointRadius: pointR,
          pointHoverRadius: pointHoverR,
          pointHoverBackgroundColor: colors.danger,
          pointBorderColor: colors.danger,
          pointBorderWidth: 0,
          pointHoverBorderWidth: 0,
          // Drawn last so it always sits on top of Advanced/On-time instead
          // of being hidden underneath a taller line passing through the
          // same point — late submissions are the ones that matter most.
          order: 3,
        },
      ],
    },
    options: {
      animation: false,
      events: onPointClick ? ["mousemove", "mouseout", "click", "touchstart", "touchmove"] : ["mousemove", "mouseout"],
      onClick: (event, elements) => { if (elements.length && onPointClick) onPointClick(rows[elements[0].index], elements[0].datasetIndex); },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", onClick: (event, item) => { if (onPointClick) onPointClick(null, item.datasetIndex); }, labels: { color: colors.text, font: DARK_CHART_DEFAULTS.font, boxWidth: 12, usePointStyle: true } },
        tooltip: { mode: "index", intersect: false, backgroundColor: colors.tooltip },
      },
      scales: {
        // A single submission used to make the top of the scale 1, placing
        // its point on the chart edge. Reserve a second unit of headroom.
        y: { beginAtZero: true, suggestedMax: 2, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } },
        x: { ticks: { color: colors.text, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
      },
    },
  });
  dashboardCharts.set(canvasId, chart);
  return chart;
}

function renderMandateComplianceChart(canvasId, mandateRows, onBarClick) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  destroyDashboardChart(canvasId);
  const colors = getChartColors();
  const rows = mandateRows.map((row) => ({
    ...row,
    // Fallbacks prevent broken labels if an older database view is still
    // cached while the analytics migration is being deployed.
    compliant_barangays: Number(row.compliant_barangays ?? row.approved_count ?? 0),
    total_barangays: Number(row.total_barangays ?? row.total_submissions ?? 0),
  })).sort((a, b) => a.compliant_barangays - b.compliant_barangays);
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.title),
      datasets: [
        {
          label: "Compliant barangays",
          data: rows.map((r) => Number(r.compliant_barangays) || 0),
          backgroundColor: rows.map((r) =>
            Number(r.compliant_barangays) === Number(r.total_barangays)
              ? colors.success
              : colors.navy,
          ),
          borderRadius: 4,
        },
      ],
    },
    options: {
      animation: false,
      events: onBarClick ? ["mousemove", "mouseout", "click", "touchstart", "touchmove"] : ["mousemove", "mouseout"],
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (!elements.length || !onBarClick) return;
        const row = rows[elements[0].index];
        onBarClick(row);
      },
      onHover: (event, elements) => {
        if (onBarClick) event.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltip,
          callbacks: {
            label: (context) => {
              const row = rows[context.dataIndex];
              return ` ${context.parsed.y} of ${row.total_barangays} barangays compliant${onBarClick ? " — click to see who" : ""}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(...rows.map((r) => Number(r.total_barangays) || 0), 1),
          ticks: { color: colors.text, precision: 0 },
          grid: { color: colors.grid },
        },
        x: { ticks: { color: colors.text, font: { size: 11 }, maxRotation: 30, minRotation: 0 }, grid: { display: false } },
      },
    },
  });
  dashboardCharts.set(canvasId, chart);
  return chart;
}

// Compatibility for any page that still calls the former chart function.
function renderMandateCompletionChart(canvasId, mandateRows) {
  return renderMandateComplianceChart(canvasId, mandateRows);
}

function renderCompliancePieChart(canvasId, cards, onSliceClick) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  destroyDashboardChart(canvasId);
  const colors = getChartColors();
  const chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["COMPLIANT", "PENDING", "LATE", "REJECTED"],
      datasets: [
        {
          data: [cards.compliant_barangays, cards.pending_submissions, cards.late_submissions, cards.rejected_submissions],
          backgroundColor: [colors.success, colors.gold, colors.warning, colors.danger],
          borderWidth: 0,
          hoverBorderWidth: 0,
          hoverOffset: 0,
        },
      ],
    },
    options: {
      animation: false,
      events: onSliceClick ? ["mousemove", "mouseout", "click", "touchstart", "touchmove"] : ["mousemove", "mouseout"],
      onClick: (event, elements) => { if (elements.length && onSliceClick) onSliceClick(elements[0].index); },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", onClick: (event, item) => { if (onSliceClick) onSliceClick(item.index); }, labels: { color: colors.text, font: DARK_CHART_DEFAULTS.font, boxWidth: 12, usePointStyle: true } },
        tooltip: { backgroundColor: colors.tooltip },
      },
      cutout: "58%",
    },
  });
  dashboardCharts.set(canvasId, chart);
  return chart;
}

// Kept as an alias in case other pages still call the old name.
function renderComplianceDonut(canvasId, cards) {
  return renderCompliancePieChart(canvasId, cards);
}
