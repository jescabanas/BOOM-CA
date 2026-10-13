const DEFAULT_BARANGAY_ORDER = [
  ...Array.from({length:11}, (_,i)=>`Barangay ${i+1}`),
  'Barra','Bocohan','Cotta','Dalahican','Domoit','Ibabang Dupay','Ilayang Dupay',
  'Gulang-Gulang','Isabang','Ibabang Iyam','Ilayang Iyam','Market View',
  'Mayao Castillo','Mayao Crossing','Mayao Kanluran','Mayao Parada','Mayao Silangan',
  'Ransohan','Salinas','Talao-Talao','Ibabang Talim','Ilayang Talim'
];
const normalizeBarangay = name => String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
const defaultOrder = new Map(DEFAULT_BARANGAY_ORDER.map((name,i)=>[normalizeBarangay(name),i]));
const esc = value => String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let currentRankingRows = [];
const now = new Date();
const asOfDate = now.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
const rankingMonth = now.toLocaleDateString('en-PH',{year:'numeric',month:'long'});
function goBack(){if(history.length>1)history.back();else location.href='index.html';}
// The public endpoint returns null ranks only when the month has no submissions.
function hasCurrentRankings(){
  return currentRankingRows.some(row=>row.current_rank != null && Number(row.current_rank)>0);
}
function displayedRows(){
  const ranked = hasCurrentRankings();
  return [...currentRankingRows].sort((a,b)=> ranked
    ? Number(a.current_rank)-Number(b.current_rank) || (defaultOrder.get(normalizeBarangay(a.barangay_name))??999)-(defaultOrder.get(normalizeBarangay(b.barangay_name))??999)
    : (defaultOrder.get(normalizeBarangay(a.barangay_name))??999)-(defaultOrder.get(normalizeBarangay(b.barangay_name))??999) || String(a.barangay_name).localeCompare(String(b.barangay_name)))
    .map((row,i)=>({...row,display_number:ranked?row.current_rank:i+1}));
}
function rankingColumns(rows){
  const size = Math.ceil(rows.length/3);
  return Array.from({length:3},(_,i)=>rows.slice(i*size,(i+1)*size)).filter(column=>column.length);
}
function renderPublicRankings(){
  const rows = displayedRows();
  document.getElementById('public-ranking-list').innerHTML = rows.length
    ? rankingColumns(rows).map(column=>`<table class="public-ranking-table public-ranking-cards" aria-label="Barangay rankings"><tbody>${column.map(r=>`<tr><td aria-label="Rank ${esc(r.display_number)}"><span class="rank-badge ${hasCurrentRankings() && r.display_number <= 3 ? "top-"+r.display_number : ""}">${esc(r.display_number)}</span></td><td>${esc(r.barangay_name)}</td></tr>`).join('')}</tbody></table>`).join('')
    : '<p>No rankings are available yet.</p>';
  document.getElementById('public-pdf-btn').disabled = !rows.length;
}
async function loadPublicRankings(){
  document.getElementById('public-period-label').textContent = `${rankingMonth} rankings — as of ${asOfDate}`;
  try {
    const {data,error}=await supabaseClient.rpc('public_barangay_rankings',{p_year:now.getFullYear(),p_month:now.getMonth()+1});
    if(error)throw error;
    currentRankingRows = data||[];
    renderPublicRankings();
  } catch(error){document.getElementById('public-ranking-list').innerHTML='<p>Could not load rankings right now.</p>';}
}
function downloadRankingsPDF(){
  if(!currentRankingRows.length)return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',format:'a4'});
  const width=doc.internal.pageSize.getWidth(), height=doc.internal.pageSize.getHeight();
  doc.setFillColor(69,8,15);doc.rect(0,0,width,34,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(9);
  doc.text('DEPARTMENT OF THE INTERIOR AND LOCAL GOVERNMENT',width/2,10,{align:'center'});
  doc.setFontSize(19);doc.text('Lucena City Barangays Rankings',width/2,21,{align:'center'});
  doc.setFontSize(10);doc.text(`${rankingMonth} rankings — as of ${asOfDate}`,width/2,29,{align:'center'});
  const ranked=hasCurrentRankings();
  doc.setTextColor(100,100,100);doc.setFontSize(9);doc.text(ranked?'Compliance ranking order':'Default barangay order',14,44);
  const gap=7, tableWidth=(width-28-gap*2)/3;
  rankingColumns(displayedRows()).forEach((column,i)=>doc.autoTable({
    startY:49,margin:{left:14+i*(tableWidth+gap),right:14,bottom:20},tableWidth,
    head:[[ranked?'Rank':'No.','Barangay']],body:column.map(r=>[String(r.display_number),r.barangay_name]),
    theme:'grid',styles:{fontSize:10,cellPadding:3,lineColor:[226,218,213],lineWidth:.15,textColor:[30,30,30]},
    headStyles:{fillColor:[69,8,15],textColor:255},alternateRowStyles:{fillColor:[253,242,235]},
    columnStyles:{0:{cellWidth:15,halign:'center'}}
  }));
  doc.setFontSize(8);doc.setTextColor(120,120,120);
  doc.text('Rankings are based on verified compliance submissions and official DILG scoring rules.',width/2,height-13,{align:'center'});
  doc.text(`Generated ${new Date().toLocaleString('en-PH')}`,14,height-7);
  doc.save(`lucena-city-barangays-rankings-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.pdf`);
}
document.getElementById('public-pdf-btn').addEventListener('click', async () => {
  const button = document.getElementById('public-pdf-btn');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Preparing PDF…';
  try {
    await loadPDFLibraries();
    downloadRankingsPDF();
    document.getElementById('public-pdf-status').textContent = '';
  } catch (error) {
    document.getElementById('public-pdf-status').textContent = 'Could not prepare PDF. Please try again.';
  } finally {
    button.textContent = 'Download PDF';
    button.disabled = !currentRankingRows.length;
  }
});
loadPublicRankings();
