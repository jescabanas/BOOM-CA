let profile, rankings = [], selection = { mode: 'monthly', value: String(currentComplianceDate().month) };
const params = new URLSearchParams(location.search);
const requestedPeriod = params.get('period') || '';
const requestedMode = params.get('analyticsMode') || '';
const requestedValue = params.get('analyticsValue') || '';
let rankingHighlight = params.get('filter') === 'approved' ? 'complied' : 'all';
let rankingRequest = 0, rankingsLoading = true, exportingPDF = false;
const body = document.getElementById('rankings-body');
const pdfButton = document.getElementById('rankings-pdf');
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

function updatePDFButton() {
  pdfButton.disabled = rankingsLoading || exportingPDF || !rankings.length;
}

function showRankingError(retry) {
  body.innerHTML = '<p role="alert">Could not load rankings. <button type="button" class="btn btn-outline">Try again</button></p>';
  body.querySelector('button').addEventListener('click', retry);
}

async function init() {
  try {
    profile = await guardPage(['super_admin', 'barangay_secretary']);
    if (!profile) return;
    renderSidebar('rankings.html', profile.role);
    initThemeToggle('theme-toggle-mount');
    if (profile.role === 'barangay_secretary') {
      rankingHighlight = 'all';
      document.querySelectorAll('.ranking-filter-card').forEach(card => {
        const stat = document.createElement('div');
        stat.className = card.className.replace(' kpi-card ranking-filter-card', '');
        stat.innerHTML = card.innerHTML;
        card.replaceWith(stat);
      });
    }
    const hasRequestedSelection = ['weekly', 'monthly', 'quarterly', 'semestral', 'periodical', 'annual'].includes(requestedMode) && requestedValue;
    if (hasRequestedSelection) {
      selection = { mode: requestedMode, value: requestedValue };
    }
    // Load saved additions alongside the standard calendar choices. Normal
    // rankings can render immediately while the deadline options load.
    let periods = [];
    const periodRequest = Promise.resolve(supabaseClient.from('compliance_periods')
      .select(ANALYTICS_PERIOD_FIELDS).order('deadline_at', { ascending: false }));
    if (selection.mode === 'periodical' || (requestedPeriod && !hasRequestedSelection)) {
      const result = await periodRequest;
      if (result.error) throw result.error;
      periods = result.data || [];
      if (!hasRequestedSelection && requestedPeriod && periods.some(period => period.id === requestedPeriod)) {
        selection = { mode: 'periodical', value: requestedPeriod };
      }
    }
    const filters = document.getElementById('rankings-period-filter');
    const renderFilters = () => {
      selection = renderAnalyticsPeriodFilter(filters, {
        years: defaultPeriodYears(), periods, ...selection,
        onChange: next => { selection = next; load(); }
      });
    };
    renderFilters();
    load();
    if (!periods.length && selection.mode !== 'periodical') {
      periodRequest.then(result => {
        if (result.error) { showToast('Additional compliance deadlines could not load. Please refresh to try again.'); return; }
        periods = result.data || [];
        renderFilters();
      }).catch(() => showToast('Additional compliance deadlines could not load. Please refresh to try again.'));
    }
  } catch (error) {
    rankingsLoading = false;
    updatePDFButton();
    showRankingError(init);
  }
}

async function load() {
  const request = ++rankingRequest;
  rankingsLoading = true;
  rankings = [];
  updatePDFButton();
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<p>Loading rankings…</p>';
  document.querySelectorAll('#ranking-stats .value').forEach(value => { value.textContent = '—'; });
  try {
    const result = await supabaseClient.rpc('analytics_period_rankings', analyticsPeriodArgs(selection));
    // A slower response from the previous selection must not replace the latest.
    if (request !== rankingRequest) return;
    if (result.error) throw result.error;
    rankings = (result.data || []).sort((a, b) => Number(a.current_rank) - Number(b.current_rank)
      || String(a.barangay_name).localeCompare(String(b.barangay_name)));
    renderRankings();
  } catch (error) {
    if (request !== rankingRequest) return;
    showRankingError(load);
  } finally {
    if (request === rankingRequest) {
      rankingsLoading = false;
      body.setAttribute('aria-busy', 'false');
      updatePDFButton();
    }
  }
}

function renderRankings() {
  const compliedIds = new Set(rankings.filter(row => row.is_compliant).map(row => row.barangay_id));
  body.innerHTML = '<table class="data-table internal-ranking-table"><thead><tr><th scope="col">Rank</th><th scope="col">Barangay</th><th scope="col">Compliance rate</th></tr></thead><tbody>'
    + rankings.map(row => {
      const complied = compliedIds.has(row.barangay_id);
      const secretary = profile.role === 'barangay_secretary' && row.barangay_id === profile.barangay_id;
      const rowClass = secretary ? 'ranking-highlight'
        : rankingHighlight === 'complied' && complied ? 'ranking-highlight-complied'
        : rankingHighlight === 'not-complied' && !complied ? 'ranking-highlight-not-complied' : '';
      return `<tr class="${rowClass}"><td><span class="rank-badge ${row.current_rank <= 3 ? 'top-' + row.current_rank : ''}">${row.current_rank}</span></td><td><strong>${esc(row.barangay_name)}</strong></td><td>${row.compliance_rate}%</td></tr>`;
    }).join('') + '</tbody></table>';
  const values = document.querySelectorAll('#ranking-stats .value');
  values[0].textContent = rankings.length;
  values[1].textContent = compliedIds.size;
  values[2].textContent = Math.max(0, rankings.length - compliedIds.size);
  document.querySelectorAll('.ranking-filter-card').forEach(card => {
    card.setAttribute('aria-pressed', String(card.dataset.rankingHighlight === rankingHighlight));
  });
}

document.querySelectorAll('.ranking-filter-card').forEach(card => card.addEventListener('click', () => {
  const next = card.dataset.rankingHighlight;
  rankingHighlight = rankingHighlight === next ? 'all' : next;
  if (!rankingsLoading && body.querySelector('table')) renderRankings();
}));

pdfButton.addEventListener('click', async () => {
  if (pdfButton.disabled) return;
  // Preserve the selected report even if the user changes filters while PDF loads.
  const rows = rankings.map(row => ({ Rank: row.current_rank, Barangay: row.barangay_name, 'Compliance rate': row.compliance_rate + '%' }));
  exportingPDF = true;
  pdfButton.textContent = 'Preparing PDF…';
  updatePDFButton();
  try {
    await loadPDFLibraries();
    exportToPDF('barangay-rankings', 'Barangay Rankings', rows);
    document.getElementById('rankings-pdf-status').textContent = '';
  } catch (error) {
    document.getElementById('rankings-pdf-status').textContent = 'Could not prepare PDF. Please try again.';
  } finally {
    exportingPDF = false;
    pdfButton.textContent = 'Download PDF';
    updatePDFButton();
  }
});
updatePDFButton();
init();
