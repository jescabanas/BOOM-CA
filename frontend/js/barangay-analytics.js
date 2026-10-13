(() => {
  let selection={mode:'monthly',value:String(currentComplianceDate().month)},snapshot=null,version=0,explorer;
  const escape=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const formatDate=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';
  const statusLabels={approved:'Approved',under_review:'Pending review',correction_requested:'Returned for revision',rejected:'Rejected',not_submitted:'Not submitted',upcoming:'Upcoming',pending:'Draft'};
  const timingLabels={on_time:'Advanced',grace_period:'On time',late:'Late',missing:'Not submitted',upcoming:'Upcoming'};
  const statusTone={approved:'success',under_review:'warning',correction_requested:'warning',rejected:'danger',not_submitted:'neutral'};
  const charts=['barangay-trend-chart','barangay-breakdown-chart','barangay-type-chart'];
  function renderReports(){
    if(!snapshot)return;
    const filter=document.getElementById('barangay-report-filter').value;
    const reports=snapshot.reports.filter(r=>filter==='all'||(filter==='submitted'?!!r.submission_id:filter==='not_submitted'||filter==='overdue'?r.overdue:filter==='upcoming'?!r.submission_id&&!r.overdue:filter==='late'?r.timing==='late':r.status===filter));
    document.getElementById('barangay-report-count').textContent=reports.length+' of '+snapshot.reports.length+' reports shown';
    document.getElementById('barangay-reports-body').innerHTML=reports.map(r=>`<tr><td><strong>${escape(r.title)}</strong><small>${escape(r.frequency)} · ${escape(r.period_label)}</small></td><td>${escape(formatDate(r.deadline_at))}${r.overdue?'<small class="barangay-overdue">Overdue</small>':''}</td><td>${escape(formatDate(r.submitted_at))}</td><td><span class="pill ${statusTone[r.status]||'neutral'}">${escape(statusLabels[r.status]||r.status)}</span></td><td><span class="pill ${r.timing==='late'?'danger':r.timing==='on_time'?'success':r.timing==='grace_period'?'warning':'neutral'}">${escape(timingLabels[r.timing]||'Not submitted')}</span></td><td>${Number(r.points)||0}${r.status==='under_review'?'<small>Provisional</small>':''}</td></tr>`).join('')||'<tr><td colspan="6">No reports match this filter.</td></tr>';
    document.querySelectorAll('[data-report-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reportFilter===filter)));
  }
  function trends(){
    const granularity=['weekly','monthly'].includes(selection.reportingMode||selection.mode)?'day':'month';
    const key=value=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return p.year+'-'+p.month+(granularity==='day'?'-'+p.day:'-01');};
    const buckets=new Map();
    snapshot.reports.filter(r=>r.submission_id).forEach(r=>{const k=key(r.submitted_at),row=buckets.get(k)||{month:k+'T12:00:00+08:00',on_time_count:0,grace_count:0,late_count:0};const field={on_time:'on_time_count',grace_period:'grace_count',late:'late_count'}[r.timing];if(field)row[field]++;buckets.set(k,row);});
    let start,end;const year=currentComplianceDate().year;
    if(selection.mode==='periodical'&&snapshot.reports[0]){const report=snapshot.reports[0];start=new Date(key(report.starts_at||report.deadline_at)+'T12:00:00+08:00');end=new Date(key(report.deadline_at)+'T12:00:00+08:00');}
    else if(selection.mode==='weekly'){const week=complianceWeekRange(selection.value);start=new Date(week.value+'T12:00:00+08:00');end=new Date(+new Date(week.end+'T12:00:00+08:00')-86400000);}
    else {const month=selection.mode==='monthly'?Number(selection.value):selection.mode==='quarterly'?(Number(selection.value)-1)*3+1:selection.mode==='semestral'?(Number(selection.value)-1)*6+1:1;const y=selection.mode==='annual'?Number(selection.value):year;const months=selection.mode==='monthly'?1:selection.mode==='quarterly'?3:selection.mode==='semestral'?6:12;start=new Date(`${y}-${String(month).padStart(2,'0')}-01T12:00:00+08:00`);end=new Date(Date.UTC(y,month-1+months,0,4));}
    // Include early uploads outside the assigned report period so no real
    // submission disappears from its trend, even when submitted in advance.
    for(const k of buckets.keys()){const date=new Date(k+'T12:00:00+08:00');if(date<start)start=date;if(date>end)end=date;}
    const rows=[];for(let cursor=new Date(start);cursor<=end;){const k=key(cursor);rows.push(buckets.get(k)||{month:k+'T12:00:00+08:00',on_time_count:0,grace_count:0,late_count:0});if(granularity==='day')cursor=new Date(+cursor+86400000);else {const p=currentComplianceDate(cursor);cursor=new Date(Date.UTC(p.year,p.month,1,4));}}
    return {rows,granularity};
  }
  function renderCharts(){
    if(!snapshot||!window.Chart)return;
    const colors=getChartColors(),trend=trends();renderSubmissionTrendsChart('barangay-trend-chart',trend.rows,trend.granularity,undefined,true);
    destroyDashboardChart('barangay-breakdown-chart');
    const summary=snapshot.summary;
    dashboardCharts.set('barangay-breakdown-chart',new Chart(document.getElementById('barangay-breakdown-chart'),{type:'doughnut',data:{labels:['SUBMITTED','NOT SUBMITTED','UPCOMING'],datasets:[{data:[summary.submitted_reports,summary.not_submitted_reports,summary.upcoming_reports],backgroundColor:[colors.success,colors.danger,colors.gold],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{color:colors.text,usePointStyle:true}},tooltip:{backgroundColor:colors.tooltip}}}}));
    const types=['Weekly','Monthly','Quarterly','Semestral','Annual','Other'].map(type=>({type,required:snapshot.reports.filter(r=>r.frequency===type).length,submitted:snapshot.reports.filter(r=>r.frequency===type&&r.submission_id).length})).filter(t=>t.required);
    destroyDashboardChart('barangay-type-chart');dashboardCharts.set('barangay-type-chart',new Chart(document.getElementById('barangay-type-chart'),{type:'bar',data:{labels:types.map(t=>t.type),datasets:[{label:'SUBMITTED',data:types.map(t=>t.submitted),backgroundColor:colors.success,borderRadius:4},{label:'REQUIRED',data:types.map(t=>t.required),backgroundColor:colors.gold,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{color:colors.text}},tooltip:{backgroundColor:colors.tooltip}},scales:{y:{beginAtZero:true,ticks:{precision:0,color:colors.text},grid:{color:colors.grid}},x:{ticks:{color:colors.text},grid:{display:false}}}}}));
  }
  function clear(){snapshot=null;charts.forEach(destroyDashboardChart);document.querySelectorAll('[data-metric]').forEach(el=>el.textContent='—');document.getElementById('barangay-score-rate').textContent='—';document.getElementById('barangay-score-points').textContent='—';document.getElementById('barangay-score-rank').textContent='—';document.getElementById('barangay-score-progress').value=0;document.getElementById('barangay-reports-body').innerHTML='<tr><td colspan="6">Loading reports…</td></tr>';document.getElementById('barangay-report-count').textContent='';document.getElementById('barangay-deadline-summary').textContent='';document.getElementById('barangay-breakdown-note').textContent='';}
  async function load(){
    const request=++version;explorer?.close();document.querySelectorAll('[data-expand-barangay-chart]').forEach(button=>button.disabled=true);clear();document.getElementById('barangay-performance').setAttribute('aria-busy','true');document.getElementById('barangay-load-state').textContent='Loading performance…';document.getElementById('barangay-refresh').disabled=true;
    try{
      const {data,error}=await supabaseClient.rpc('my_barangay_analytics',analyticsPeriodArgs(selection));if(request!==version)return;
      if(error||!data?.summary||!Array.isArray(data.reports))throw new Error('Could not load barangay performance. Please refresh to try again.');
      snapshot=data;const s=data.summary;document.getElementById('analytics-title').textContent=data.barangay.name+' Analytics';
      document.querySelectorAll('[data-metric]').forEach(el=>el.textContent=el.dataset.metric==='rank'?(s.rank?'#'+s.rank:'—'):el.dataset.metric==='compliance_rate'?Number(s.compliance_rate)+'%':s[el.dataset.metric]??0);
      document.getElementById('barangay-score-rate').textContent=Number(s.compliance_rate)+'%';document.getElementById('barangay-score-progress').value=Number(s.compliance_rate);
      document.getElementById('barangay-score-points').textContent=s.total_points+' of '+s.possible_points+' possible points';document.getElementById('barangay-score-rank').textContent=s.rank?'#'+s.rank+' of '+s.ranked_barangays:'—';
      document.getElementById('barangay-deadline-summary').textContent=s.not_submitted_reports+' not submitted, deadline passed · '+s.upcoming_reports+' upcoming';
      document.getElementById('barangay-breakdown-note').textContent=s.required_reports?'Only reports with an attached file count as submitted.':'No requirements are assigned to this period.';
      document.getElementById('barangay-rankings-link').href='rankings.html?'+new URLSearchParams({analyticsMode:selection.mode,analyticsValue:selection.value});
      document.getElementById('barangay-load-state').textContent='Performance loaded. Includes previous secretaries’ submissions for this barangay.';renderReports();renderCharts();
      document.querySelectorAll('[data-expand-barangay-chart]').forEach(button=>button.disabled=!window.Chart);
    }catch(error){if(request!==version)return;document.getElementById('barangay-load-state').textContent=error.message;document.getElementById('barangay-reports-body').innerHTML='<tr><td colspan="6">Performance could not load. Use Refresh to try again.</td></tr>';}
    finally{if(request===version){document.getElementById('barangay-performance').setAttribute('aria-busy','false');document.getElementById('barangay-refresh').disabled=false;}}
  }
  async function loadPeriodOptions(){
    const {data:periods,error}=await supabaseClient.from('compliance_periods').select(ANALYTICS_PERIOD_FIELDS).order('deadline_at',{ascending:false});
    if(error){document.getElementById('barangay-load-state').textContent='Some period options could not load. Refresh to try again.';if(document.querySelector('#barangay-period-filter select'))return;}
    selection=renderAnalyticsPeriodFilter(document.getElementById('barangay-period-filter'),{years:[...new Set([...(periods||[]).map(p=>p.compliance_year),...defaultPeriodYears()])].sort((a,b)=>b-a),periods:periods||[],mode:selection.reportingMode||selection.mode,value:selection.value,onChange:value=>{selection=value;load();}});
  }
  async function refresh(){document.getElementById('barangay-refresh').disabled=true;await loadPeriodOptions();await load();}
  async function init(){
    const profile=await guardPage(['barangay_secretary']);if(!profile)return;renderSidebar('barangay-analytics.html',profile.role);initThemeToggle('theme-toggle-mount');
    await loadPeriodOptions();
    await load();
  }
  document.getElementById('barangay-report-filter').addEventListener('change',renderReports);
  document.getElementById('barangay-refresh').addEventListener('click',refresh);
  document.querySelectorAll('[data-report-filter]').forEach(button=>button.addEventListener('click',()=>{document.getElementById('barangay-report-filter').value=button.dataset.reportFilter;renderReports();document.getElementById('barangay-report-tracker').scrollIntoView({block:'start'});}));
  document.addEventListener('bcs-theme-change',renderCharts);
  explorer=initBarangayChartExplorer(()=>snapshot?{...snapshot,period:selection,trend:trends()}:null);
  init();
})();
