// Shared "Analytics period" Month + Year filter control, used on Analytics,
// Review, Rankings, History, Audit Log, and My Submissions.
const PERIOD_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ANALYTICS_PERIOD_FIELDS = 'id,title,period_label,compliance_year,deadline_at,starts_at,occurrence_key,deadline_schedule_id,compliance_deadline_schedules(frequency)';

function defaultPeriodYears() {
  const current = Math.max(2026, currentComplianceDate().year);
  const years = [];
  for (let year = current; year >= 2026; year--) years.push(year);
  return years;
}

function currentComplianceDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  return { year: Number(parts.find(p => p.type === 'year').value), month: Number(parts.find(p => p.type === 'month').value), day: Number(parts.find(p => p.type === 'day').value) };
}

function complianceFrequency(period, schedules = {}) {
  const frequency = period.frequency || period.compliance_deadline_schedules?.frequency || schedules[period.deadline_schedule_id]?.frequency;
  if (frequency) return frequency === 'Periodical' ? 'Semestral' : frequency;
  const label = String(period.period_label || '').toLowerCase();
  if (/week/.test(label)) return 'Weekly';
  if (/quarter/.test(label)) return 'Quarterly';
  if (/semestr|semester|half/.test(label)) return 'Semestral';
  if (/annual|year/.test(label)) return 'Annual';
  if (/month/.test(label) || PERIOD_MONTHS.some(m => label === m.toLowerCase())) return 'Monthly';
  return 'Semestral';
}

// Occurrence identifies the assigned period even when staff move its due date.
function complianceMonth(period) {
  const key = period.occurrence_key || '';
  if (/^\d{4}-\d{2}/.test(key)) return Number(key.slice(5, 7));
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'numeric' }).format(new Date(period.deadline_at)));
}

// Renders two <select> elements (Month, Year) into mountEl and calls
// onChange({month, year}) whenever either changes. month is "1".."12" or ""
// for all months; year is a 4-digit string or "" for all years.
function renderPeriodFilter(mountEl, { years, month = "", year = "", onChange }) {
  years = defaultPeriodYears();
  mountEl.innerHTML = `
    <label>Analytics period</label>
    <select class="period-month">
      <option value="">All months</option>
      ${PERIOD_MONTHS.map((m, i) => `<option value="${i + 1}" ${String(month) === String(i + 1) ? "selected" : ""}>${m}</option>`).join("")}
    </select>
    <select class="period-year">
      <option value="">All years</option>
      ${years.map((y) => `<option value="${y}" ${String(year) === String(y) ? "selected" : ""}>${y}</option>`).join("")}
    </select>`;
  const monthSelect = mountEl.querySelector(".period-month");
  const yearSelect = mountEl.querySelector(".period-year");
  const emit = () => onChange({ month: monthSelect.value, year: yearSelect.value });
  monthSelect.addEventListener("change", emit);
  yearSelect.addEventListener("change", emit);
}

// Month/year plus an optional named compliance deadline. "All deadlines"
// keeps the broader month view; selecting one makes analytics specific.
function renderCompliancePeriodFilter(mountEl, { years, periods, month = "", year = "", compliancePeriodId = "", onChange }) {
  years = defaultPeriodYears();
  mountEl.innerHTML = `
    <label>Analytics period</label>
    <select class="period-month"><option value="">All months</option>${PERIOD_MONTHS.map((m,i)=>`<option value="${i+1}" ${String(month)===String(i+1)?"selected":""}>${m}</option>`).join("")}</select>
    <select class="period-year"><option value="">All years</option>${years.map(y=>`<option value="${y}" ${String(year)===String(y)?"selected":""}>${y}</option>`).join("")}</select>
    <select class="compliance-period"><option value="">All compliance deadlines</option></select>`;
  const monthSelect=mountEl.querySelector(".period-month"), yearSelect=mountEl.querySelector(".period-year"), deadlineSelect=mountEl.querySelector(".compliance-period");
  let initialCompliancePeriodId = compliancePeriodId;
  const refreshDeadlines=()=>{const selected=initialCompliancePeriodId||deadlineSelect.value;initialCompliancePeriodId=null;const matching=periods.filter(p=>(!yearSelect.value||p.compliance_year===Number(yearSelect.value))&&(!monthSelect.value||new Date(p.deadline_at).getMonth()+1===Number(monthSelect.value)));deadlineSelect.innerHTML='<option value="">All compliance deadlines</option>'+matching.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${p.title}</option>`).join("");};
  const emit=()=>onChange({month:monthSelect.value,year:yearSelect.value,compliancePeriodId:deadlineSelect.value});
  monthSelect.addEventListener("change",()=>{refreshDeadlines();emit();});yearSelect.addEventListener("change",()=>{refreshDeadlines();emit();});deadlineSelect.addEventListener("change",emit);refreshDeadlines();
}

// Match compliance_calendar: four assigned report weeks, with Week 4 covering
// the remaining days of the month. No week borrows dates from another month.
function complianceWeeksForMonth(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue)) return [];
  const [year, month] = monthValue.split('-').map(Number);
  if (month < 1 || month > 12) return [];
  const iso = date => date.toISOString().slice(0, 10);
  const label = date => date.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return [1, 2, 3, 4].map(number => {
    const start = new Date(Date.UTC(year, month - 1, (number - 1) * 7 + 1));
    const end = number === 4 ? new Date(Date.UTC(year, month, 1)) : new Date(+start + 7 * 86400000);
    return { value: iso(start), end: iso(end), label: `Week ${number} (${label(start)} – ${label(new Date(+end - 86400000))})` };
  });
}

function complianceWeekRange(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  return complianceWeeksForMonth(value.slice(0, 7)).find(week => value >= week.value && value < week.end) || null;
}

// Extra choices come only from saved deadlines. The recurring calendar already
// supplies the standard slots; uploading a report cannot add another choice.
function additionalCompliancePeriods(periods, mode, monthValue = '') {
  const standardKeys = {
    weekly: /^\d{4}-\d{2}-W[1-4]$/,
    monthly: /^\d{4}-\d{2}-M[1-4]$/,
    quarterly: /^\d{4}-Q[1-4]$/,
    semestral: /^\d{4}-S[12]$/,
    annual: /^\d{4}$/,
  };
  const year = monthValue ? Number(monthValue.slice(0, 4)) : currentComplianceDate().year;
  return (periods || []).filter(period =>
    period.id && complianceFrequency(period).toLowerCase() === mode &&
    !standardKeys[mode]?.test(period.occurrence_key || '') &&
    period.compliance_year === year &&
    (!monthValue || complianceMonth(period) === Number(monthValue.slice(5, 7)))
  ).sort((a, b) => new Date(a.deadline_at) - new Date(b.deadline_at) || String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
}

// Analytics uses a two-step period picker: first choose the period type, then
// choose a matching week, month, quarter, compliance deadline, or year.
function renderAnalyticsPeriodFilter(mountEl, { years, periods, mode = "monthly", value = "", onChange }) {
  years = defaultPeriodYears();
  const today = currentComplianceDate();
  const pad = (number) => String(number).padStart(2, "0");
  const todayISO = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const escapeOption = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selectedReport = (periods || []).find(period => period.id === value);
  if (mode === 'periodical' && selectedReport && additionalCompliancePeriods(periods, complianceFrequency(selectedReport).toLowerCase(), `${selectedReport.compliance_year}-${pad(complianceMonth(selectedReport))}`).some(period => period.id === value)) {
    mode = complianceFrequency(selectedReport).toLowerCase();
  }
  const reportLabel = period => `${period.title} (${period.period_label} · ${PERIOD_MONTHS[complianceMonth(period) - 1]} ${period.compliance_year})`;
  const renderOptions = (options, selected) => options.map(item => `<option value="${escapeOption(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeOption(item.label)}</option>`).join('');
  const extraOptions = monthValue => additionalCompliancePeriods(periods, mode, monthValue).map(period => ({value:period.id,label:reportLabel(period)}));
  const renderExtraOptions = (options, selected) => options.length ? `<optgroup label="Administrator-created deadlines">${renderOptions(options, selected)}</optgroup>` : '';
  const weeklyMonths = years.flatMap(year => PERIOD_MONTHS.map((label, index) => ({ value: `${year}-${pad(index + 1)}`, label: `${label} ${year}` })));
  const choices = () => {
    if (mode === "semestral") return [1, 2].map(n => ({value:String(n),label:`Semester ${n}`}));
    if (mode === "monthly") return PERIOD_MONTHS.map((label, index) => ({ value: String(index + 1), label }));
    if (mode === "quarterly") return [1, 2, 3, 4].map((quarter) => ({ value: String(quarter), label: `Quarter ${quarter}` }));
    if (mode === "periodical") return (periods || []).map((period) => ({ value: period.id, label: `${period.title} (${period.period_label} ${period.compliance_year})` }));
    return years.map((year) => ({ value: String(year), label: String(year) }));
  };
  const defaultValue = () => {
    if (mode === "semestral") return String(Math.floor((today.month - 1) / 6) + 1);
    if (mode === "monthly") return String(today.month);
    if (mode === "quarterly") return String(Math.floor((today.month - 1) / 3) + 1);
    if (mode === "periodical") return periods?.[0]?.id || "";
    return String(today.year);
  };
  const renderValueOptions = (selectedValue) => {
    const options = choices();
    const extra = mode === 'periodical' ? [] : extraOptions();
    const selected = [...options, ...extra].some((item) => item.value === selectedValue) ? selectedValue : defaultValue();
    valueSelect.innerHTML = options.length
      ? renderOptions(options, selected) + renderExtraOptions(extra, selected)
      : '<option value="">No periods available</option>';
    return valueSelect.value;
  };
  mountEl.innerHTML = `
    <label>Analytics period</label>
    <select class="analytics-period-mode">
      <option value="weekly">Weekly</option>
      <option value="monthly">Monthly</option>
      <option value="quarterly">Quarterly</option>
      <option value="semestral">Semestral</option>
      <option value="periodical" hidden>Selected report</option>
      <option value="annual">Annual</option>
    </select>
    <select class="analytics-period-month" hidden></select>
    <select class="analytics-period-value"></select>`;
  const modeSelect = mountEl.querySelector(".analytics-period-mode");
  const valueSelect = mountEl.querySelector(".analytics-period-value");
  const weekMonthSelect = mountEl.querySelector(".analytics-period-month");
  const renderWeeklyOptions = (selectedWeek = value, selectedMonthValue = "") => {
    const report = (periods || []).find(period => period.id === selectedWeek);
    const normalizedWeek = complianceWeekRange(selectedWeek)?.value;
    const selectedMonth = selectedMonthValue || (report ? `${report.compliance_year}-${pad(complianceMonth(report))}` : '') || normalizedWeek?.slice(0, 7) || todayISO.slice(0, 7);
    weekMonthSelect.innerHTML = weeklyMonths.map((item) => `<option value="${item.value}" ${item.value === selectedMonth ? "selected" : ""}>${item.label}</option>`).join("");
    const weeks = complianceWeeksForMonth(weekMonthSelect.value);
    const extra = extraOptions(weekMonthSelect.value);
    const chosen = extra.some(item => item.value === selectedWeek) ? selectedWeek : weeks.some((item) => item.value === normalizedWeek) ? normalizedWeek : weeks.find(item => todayISO >= item.value && todayISO < item.end)?.value || weeks[0]?.value || "";
    valueSelect.innerHTML = renderOptions(weeks, chosen) + renderExtraOptions(extra, chosen);
    return valueSelect.value;
  };
  const renderControls = (selectedValue = "") => {
    const weekly = mode === "weekly";
    weekMonthSelect.hidden = !weekly;
    if (weekly) return renderWeeklyOptions(selectedValue);
    return renderValueOptions(selectedValue);
  };
  modeSelect.value = mode;
  value = renderControls(value);
  const selection = () => {
    const report = (periods || []).find(period => period.id === valueSelect.value);
    return report ? {mode:'periodical',value:report.id,reportingMode:mode} : {mode,value:valueSelect.value};
  };
  const emit = () => onChange(selection());
  modeSelect.addEventListener("change", () => {
    mode = modeSelect.value;
    value = renderControls("");
    emit();
  });
  weekMonthSelect.addEventListener("change", () => {
    value = renderWeeklyOptions("", weekMonthSelect.value);
    emit();
  });
  valueSelect.addEventListener("change", () => {
    value = valueSelect.value;
    emit();
  });
  return selection();
}

function analyticsPeriodArgs(selection) {
  return {
    p_period_type: selection.mode,
    p_period_value: (selection.mode === 'weekly' ? complianceWeekRange(selection.value)?.value : selection.value) || null,
  };
}

function matchesAnalyticsPeriod(dateValue, selection) {
  if (!dateValue || !selection?.value) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const local = currentComplianceDate(date), currentYear = currentComplianceDate().year;
  if (selection.mode === "annual") return local.year === Number(selection.value);
  if (selection.mode === "monthly") return local.month === Number(selection.value) && local.year === currentYear;
  if (selection.mode === "semestral") return Math.floor((local.month-1) / 6) + 1 === Number(selection.value) && local.year === currentYear;
  if (selection.mode === "quarterly") return Math.floor((local.month-1) / 3) + 1 === Number(selection.value) && local.year === currentYear;
  if (selection.mode === "weekly") {
    const week = complianceWeekRange(selection.value);
    if (!week) return false;
    const start = new Date(`${week.value}T00:00:00+08:00`);
    const end = new Date(`${week.end}T00:00:00+08:00`);
    return date >= start && date < end;
  }
  return false;
}

// Resolves the "most recent" period defaults shared by every Analytics
// period filter: the latest compliance deadline (periods is already sorted
// deadline_at desc by every caller), and the month/year that deadline falls
// in — so the month/year and compliance-deadline dropdowns always agree
// with each other instead of accidentally filtering to nothing.
function latestPeriodDefaults(periods) {
  const latest = periods && periods.length ? periods[0] : null;
  const now = new Date();
  return {
    month: latest ? String(new Date(latest.deadline_at).getMonth() + 1) : String(now.getMonth() + 1),
    year: latest ? String(latest.compliance_year) : String(now.getFullYear()),
    compliancePeriodId: latest ? latest.id : "",
  };
}

// True when dateValue falls within the selected month/year ("" = any).
function matchesPeriod(dateValue, month, year) {
  if (!month && !year) return true;
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (year && d.getFullYear() !== Number(year)) return false;
  if (month && d.getMonth() + 1 !== Number(month)) return false;
  return true;
}

// History belongs to the assigned report, including submissions sent early.
function matchesComplianceAnalyticsPeriod(period, selection) {
  if (!period) return false;
  const key = period.occurrence_key || '';
  let assigned = period.deadline_at;
  if (/^\d{4}-\d{2}/.test(key)) assigned = key.slice(0,7) + '-01T12:00:00+08:00';
  else if (/^\d{4}-Q[1-4]$/.test(key)) assigned = key.slice(0,4) + '-' + String((Number(key.slice(-1))-1)*3+1).padStart(2,'0') + '-01T12:00:00+08:00';
  else if (/^\d{4}-S[12]$/.test(key)) assigned = key.slice(0,4) + (key.endsWith('1') ? '-01' : '-07') + '-01T12:00:00+08:00';
  if (selection.mode === 'annual') return period.compliance_year === Number(selection.value);
  // Weekly filters use the actual assigned week start, rather than upload time.
  if (selection.mode === 'weekly' && /^\d{4}-\d{2}-W[1-4]$/.test(key)) assigned = key.slice(0,7) + '-' + String((Number(key.slice(-1))-1)*7+1).padStart(2,'0') + 'T12:00:00+08:00';
  return matchesAnalyticsPeriod(assigned, selection);
}
