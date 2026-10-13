// Explore the already authorized barangay snapshot; no extra API calls.
function initBarangayChartExplorer(getSnapshot) {
  const definitions={trend:{title:'Submission Trends',canvas:'barangay-trend-chart'},breakdown:{title:'Report Breakdown',canvas:'barangay-breakdown-chart'},type:{title:'Reports by Compliance Type',canvas:'barangay-type-chart'}};
  const escape=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const dateKey=(value,granularity)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+(granularity==='day'?'-'+parts.day:'');};
  const formatDate=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';
  const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,value])=>[key,clone(value)])):value;
  const canvasId='expanded-barangay-chart';
  let dialog,snapshot,kind,opener,previousOverflow,selected=0,selectedDate='',selectedType='';
  const bands=['on_time','grace_period','late'],bandLabels=['Advanced','On time','Late'],breakdownLabels=['Submitted','Not submitted','Upcoming'];
  function details(){
    let rows=snapshot.reports,title;
    if(kind==='trend'){rows=rows.filter(r=>r.submission_id&&r.timing===bands[selected]&&(!selectedDate||dateKey(r.submitted_at,snapshot.trend.granularity)===selectedDate));title=bandLabels[selected];}
    if(kind==='breakdown'){rows=rows.filter(r=>selected===0?!!r.submission_id:selected===1?r.overdue:!r.submission_id&&!r.overdue);title=breakdownLabels[selected];}
    if(kind==='type'){rows=rows.filter(r=>(!selectedType||r.frequency===selectedType)&&(selected===1||r.submission_id));title=(selected===0?'Submitted':'Required')+' · '+(selectedType||'All types');}
    dialog.querySelector('.chart-explorer-details').innerHTML=`<h3>${escape(title)}</h3><p>${rows.length} reports · ${escape(snapshot.barangay.name)}${selectedDate?' · '+escape(selectedDate):''}</p><div class="chart-detail-list">${rows.map(r=>`<div class="chart-detail-item"><strong>${escape(r.title)}</strong><small>${escape(r.frequency)} · ${escape(r.period_label)}</small><small>${escape(r.status.replaceAll('_',' '))} · ${escape(r.timing==='upcoming'?'Upcoming':bandLabels[bands.indexOf(r.timing)]||'Not submitted')}</small><small>Deadline: ${escape(formatDate(r.deadline_at))}<br>First submitted: ${escape(formatDate(r.submitted_at))}</small></div>`).join('')||'<p class="chart-empty">No matching reports in this selection.</p>'}</div>`;
    dialog.querySelectorAll('[data-choice]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.choice)===selected)));
    const select=dialog.querySelector('select');if(select)select.value=kind==='trend'?selectedDate:selectedType;
  }
  function renderChart(){
    const source=dashboardCharts.get(definitions[kind].canvas);if(!source)return;
    destroyDashboardChart(canvasId);
    const options=clone(source.config.options);
    options.animation=false;options.responsive=true;options.maintainAspectRatio=false;options.events=['mousemove','mouseout','click','touchstart','touchmove'];
    options.onClick=(event,elements)=>{if(!elements.length)return;const point=elements[0];if(kind==='trend'){selected=point.datasetIndex;selectedDate=dateKey(snapshot.trend.rows[point.index].month,snapshot.trend.granularity);}if(kind==='breakdown')selected=point.index;if(kind==='type'){selected=point.datasetIndex;selectedType=source.data.labels[point.index];}details();};
    options.plugins.legend.onClick=(event,item)=>{selected=kind==='breakdown'?item.index:item.datasetIndex;details();};
    dashboardCharts.set(canvasId,new Chart(document.getElementById(canvasId),{type:source.config.type,data:clone(source.data),options}));
  }
  function close(){
    if(!dialog)return;destroyDashboardChart(canvasId);dialog.close();dialog.remove();dialog=null;
    document.body.style.overflow=previousOverflow;opener?.focus({preventScroll:true});
  }
  function open(type,trigger){
    const data=getSnapshot();if(!data||!window.Chart||!dashboardCharts.has(definitions[type].canvas))return;
    close();snapshot=structuredClone(data);kind=type;opener=trigger;selected=0;selectedDate='';selectedType='';
    dialog=document.createElement('dialog');dialog.className='chart-explorer barangay-chart-explorer';dialog.setAttribute('aria-labelledby','barangay-explorer-title');
    dialog.innerHTML=`<header class="chart-explorer-header"><div><div class="eyebrow">${escape(snapshot.barangay.name)} · ${escape(snapshot.period.mode)} period</div><h2 id="barangay-explorer-title">${definitions[kind].title}</h2><p>Click the chart or use the controls below to explore your barangay's reports.</p></div><button type="button" class="btn btn-outline dialog-close" aria-label="Close expanded chart">×</button></header><div class="chart-explorer-content"><section class="chart-explorer-plot"><div class="chart-explorer-canvas"><canvas id="${canvasId}" role="img" aria-label="${definitions[kind].title}. Use the controls below for the same details."></canvas></div><div class="chart-explorer-options" aria-label="Chart detail filters"></div></section><aside class="chart-explorer-details" aria-live="polite"></aside></div>`;
    const controls=dialog.querySelector('.chart-explorer-options');
    const labels=kind==='trend'?bandLabels:kind==='breakdown'?breakdownLabels:['Submitted','Required'];
    controls.innerHTML=labels.map((label,i)=>`<button type="button" class="btn btn-outline" data-choice="${i}" aria-pressed="false">${label}</button>`).join('');
    if(kind==='trend'){const dates=[...new Set(snapshot.trend.rows.map(r=>dateKey(r.month,snapshot.trend.granularity)))];controls.insertAdjacentHTML('beforeend',`<label>Submission date<select aria-label="Filter submission date"><option value="">All dates</option>${dates.map(date=>`<option value="${date}">${date}</option>`).join('')}</select></label>`);}
    if(kind==='type'){const types=dashboardCharts.get(definitions[kind].canvas).data.labels;controls.insertAdjacentHTML('beforeend',`<label>Compliance type<select aria-label="Filter compliance type"><option value="">All types</option>${types.map(type=>`<option value="${escape(type)}">${escape(type)}</option>`).join('')}</select></label>`);}
    controls.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',()=>{selected=Number(button.dataset.choice);details();}));
    controls.querySelector('select')?.addEventListener('change',event=>{if(kind==='trend')selectedDate=event.target.value;else selectedType=event.target.value;details();});
    document.body.appendChild(dialog);previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    dialog.querySelector('.dialog-close').addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();});
    dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const controls=[...dialog.querySelectorAll('button,select,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
    dialog.showModal();renderChart();details();dialog.querySelector('.dialog-close').focus({preventScroll:true});
  }
  document.querySelectorAll('[data-expand-barangay-chart]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.expandBarangayChart,button)));
  document.addEventListener('bcs-theme-change',()=>{if(dialog?.open)renderChart();});
  return {close};
}
