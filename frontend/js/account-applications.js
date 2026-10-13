// Application requests are not accounts. All writes and account creation run server-side.
(() => {
 const escape = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const date = value => value ? new Date(value).toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}) : "—";
 const statusLabel = status => ({pending:"Awaiting review",approving:"Approval in progress",approved:"Approved",denied:"Denied"}[status]||status);
 const statusClass = status => ({pending:"warning",approving:"warning",approved:"success",denied:"danger"}[status]||"neutral");
 async function invoke(name,body) {
  const {data,error}=await supabaseClient.functions.invoke(name,{body});
  if(error){let message;try{message=(await error.context.json()).error;}catch{}throw new Error(message||error.message||"Request failed. Please try again.");}
  if(data?.error)throw new Error(data.error);
  return data;
 }
 function message(element,text){element.textContent=text||"";element.hidden=!text;}
 function modal(id,title,body,wide=false){
  const root=document.createElement("div");root.id=id;root.className="application-backdrop";
  root.innerHTML='<section class="card application-dialog '+(wide?"application-review":"")+'" role="dialog" aria-modal="true" aria-labelledby="'+id+'-title"><div class="dialog-heading"><div><div class="eyebrow">'+(wide?"Administrator review":"DILG Lucena · Account access")+'</div><h3 id="'+id+'-title">'+escape(title)+'</h3></div><button type="button" class="btn btn-outline dialog-close" aria-label="Close '+(wide?"application review":"account application")+'">×</button></div>'+body+'</section>';
  document.body.appendChild(root);
  root.querySelector(".dialog-close").addEventListener("click",()=>root.remove());
  initializeDialog(root,root.querySelector(".dialog-close"),{observe:false});
  return root;
 }
 const requiredDocuments=[['appointment_letter','Appointment letter'],['authentication_of_office','Authentication of office'],['pds','PDS (Personal Data Sheet)']];
 const applyButton=document.getElementById("apply-account-btn");
 applyButton?.addEventListener("click",async()=>{
  if(document.getElementById("account-application-modal"))return;
  const root=modal("account-application-modal","Apply for a Barangay Secretary account",
   '<p class="dialog-description">Request access for your official barangay duties. Returning secretaries should use their original email and upload current documents. An administrator must approve your account before access is restored.</p>'+
   '<div class="application-step"><span>1</span><div><strong>Apply → Review → Set your password</strong><p>No account access is granted until approval.</p></div></div>'+
   '<form id="account-application-form"><div class="field"><label for="app-full-name">Full name</label><input id="app-full-name" name="full_name" required minlength="2" maxlength="120" autocomplete="name" placeholder="Your complete name" /></div>'+
   '<div class="field"><label for="app-email">Email address</label><input id="app-email" name="email" required maxlength="254" type="email" autocomplete="email" placeholder="An email address you can access" /><small class="field-hint">Your password-setup email will be sent here after approval.</small></div>'+
   '<div class="field"><label for="app-barangay">Assigned barangay · Lucena City</label><select id="app-barangay" name="barangay_id" required disabled><option value="">Loading barangays…</option></select></div>'+
   requiredDocuments.map(([key,label])=>'<div class="field"><label for="app-'+key+'">'+label+' (required)</label><label class="application-dropzone"><span class="application-upload-icon" aria-hidden="true">↥</span><strong>Choose a file or drag it here</strong><input id="app-'+key+'" name="'+key+'" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required /><small>PDF, PNG or JPG · maximum 10 MB per file</small></label></div>').join('')+
   '<div class="application-honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off" /></label></div>'+
   '<label class="application-consent"><input type="checkbox" id="app-consent" required /><span>I confirm these details are accurate and authorize DILG Lucena to use the three uploaded documents to verify this access request. Only authorized administrators can review them.</span></label>'+
   '<div class="application-message" id="app-message" role="alert" hidden></div>'+
   '<div class="dialog-actions"><button type="button" class="btn btn-outline" id="app-cancel">Cancel</button><button type="submit" class="btn btn-primary" id="app-submit" disabled>Submit application</button></div></form>');
  root.querySelector("#app-cancel").onclick=()=>root.querySelector(".dialog-close").click();
  const form=root.querySelector("form"),select=root.querySelector("#app-barangay"),button=root.querySelector("#app-submit"),errorBox=root.querySelector("#app-message");
  root.querySelectorAll('input[type="file"]').forEach(file=>{
  const drop=file.closest(".application-dropzone");
  file.addEventListener("change",()=>{file.setCustomValidity("");if(file.files[0]?.size>10*1024*1024)file.setCustomValidity("Choose a document up to 10 MB.");file.reportValidity();});
  ["dragenter","dragover"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add("dragover");}));
  ["dragleave","drop"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove("dragover");if(type==="drop"&&e.dataTransfer.files.length){const transfer=new DataTransfer();transfer.items.add(e.dataTransfer.files[0]);file.files=transfer.files;file.dispatchEvent(new Event("change"));}}));
  });
  try{
   const data=await invoke("submit-account-application",{action:"barangays"});
   if(!root.isConnected)return;
   const rows=(data.barangays||[]).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
   select.innerHTML='<option value="">Select your barangay</option>'+rows.map(b=>'<option value="'+escape(b.id)+'">'+escape(b.name)+'</option>').join("");
   if(!rows.length)throw new Error("No active barangays are available. Please contact DILG Lucena.");
   select.disabled=false;button.disabled=false;
  }catch(error){if(root.isConnected){select.innerHTML='<option value="">Unable to load barangays</option>';message(errorBox,error.message+" Close this form and try again.");}}
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(!form.reportValidity()||button.disabled)return;
   for(const [key,label] of requiredDocuments){
    const selected=root.querySelector('#app-'+key).files[0];
    if(!selected||!selected.size||selected.size>10*1024*1024||! /\.(pdf|png|jpe?g)$/i.test(selected.name)){message(errorBox,label+': choose a non-empty PDF, PNG or JPG up to 10 MB.');return;}
   }
   button.disabled=true;button.textContent="Submitting…";message(errorBox,"");
   const body=new FormData(form);body.set("consent",String(root.querySelector("#app-consent").checked));body.set("setup_redirect",new URL("reset-password.html",location.href).href);
   try{
    await invoke("submit-account-application",body);
    if(!root.isConnected)return;
    form.innerHTML='<div class="application-success" role="status"><span class="success-mark" aria-hidden="true">✓</span><h3>Application received</h3><p>If eligible, your request will be reviewed by DILG Lucena. Approved applicants receive an email to set their password.</p><p>You cannot sign in until your account is approved.</p><button type="button" class="btn btn-primary" id="app-done">Back to sign in</button></div>';
    root.querySelector("#app-done").onclick=()=>root.querySelector(".dialog-close").click();root.querySelector("#app-done").focus();
   }catch(error){if(root.isConnected){message(errorBox,error.message);button.disabled=false;button.textContent="Submit application";}}
  });
 });

 let applications=[],requestSequence=0;
 function renderApplications(){
  const table=document.getElementById("applications-body");if(!table)return;
  const filter=document.getElementById("application-filter").value,search=document.getElementById("application-search").value.trim().toLowerCase();
  const pending=applications.filter(a=>["pending","approving"].includes(a.status)).length,count=document.getElementById("application-pending-count");
  count.textContent=String(pending);count.hidden=pending===0;
  const rows=applications.filter(a=>(filter==="all"||(filter==="pending"?["pending","approving"].includes(a.status):a.status===filter))&&[a.full_name,a.email,a.barangays?.name].some(v=>String(v||"").toLowerCase().includes(search)));
  document.getElementById("application-list-summary").textContent=rows.length+" application"+(rows.length===1?"":"s")+" shown · "+pending+" awaiting review";
  table.innerHTML=rows.map(a=>'<tr><td><strong>'+escape(a.full_name)+'</strong><br><span class="field-hint">'+escape(a.email)+'</span></td><td>'+escape(a.barangays?.name||"—")+'</td><td>'+date(a.created_at)+'</td><td><span class="pill '+statusClass(a.status)+'">'+statusLabel(a.status)+'</span></td><td><button type="button" class="btn btn-outline btn-small" data-review-application="'+escape(a.id)+'">Review application</button></td></tr>').join("")||'<tr><td colspan="5" style="text-align:center;padding:36px;">No applications match this view.</td></tr>';
 }
 window.loadAccountApplications=async()=>{
  if(!document.getElementById("applications-body"))return;
  const sequence=++requestSequence,refresh=document.getElementById("application-refresh");refresh.disabled=true;
  const {data,error}=await supabaseClient.from("account_applications").select("*, barangays(name)").order("created_at",{ascending:false}).limit(500);
  if(sequence!==requestSequence)return;
  refresh.disabled=false;
  if(error){document.getElementById("applications-body").innerHTML='<tr><td colspan="5" class="application-message">Could not load applications. Please refresh or contact your system administrator.</td></tr>';document.getElementById("application-list-summary").textContent="Applications unavailable";return;}
  applications=data||[];renderApplications();
 };
 document.getElementById("application-filter")?.addEventListener("change",renderApplications);
 document.getElementById("application-search")?.addEventListener("input",renderApplications);
 document.getElementById("application-refresh")?.addEventListener("click",()=>loadAccountApplications());
 document.getElementById("applications-body")?.addEventListener("click",async event=>{
  const button=event.target.closest("[data-review-application]");if(!button)return;
  const a=applications.find(row=>row.id===button.dataset.reviewApplication);if(!a||document.getElementById("application-review-modal"))return;
  const reviewable=["pending","approving"].includes(a.status),restoring=!!a.restoration_user_id;
  const root=modal("application-review-modal","Application review",
   '<div class="application-review-grid"><aside class="application-profile"><dl><dt>Full name</dt><dd>'+escape(a.full_name)+'</dd><dt>Email address</dt><dd>'+escape(a.email)+'</dd><dt>Assigned barangay</dt><dd>'+escape(a.barangays?.name||"—")+'</dd><dt>Requested role</dt><dd>Barangay Secretary</dd><dt>Applied</dt><dd>'+date(a.created_at)+'</dd><dt>Status</dt><dd><span class="pill '+statusClass(a.status)+'">'+statusLabel(a.status)+'</span></dd></dl>'+
   (reviewable?'<p class="application-reviewed-note">'+(restoring?'Approval restores the original Secretary account and preserves its files, authorship and history. A fresh sign-in is required. If this barangay has an active secretary, this account waits for a handover in Barangay Access.':'Approval creates a Secretary account for this barangay and emails password-setup instructions.')+'</p><button type="button" class="btn btn-primary" id="app-approve">'+(restoring?'Approve & restore account':'Approve & create account')+'</button><button type="button" class="btn btn-outline" id="app-deny" '+(a.provisioned_user_id&&!restoring?'disabled':'')+'>Deny application</button><div id="app-denial-fields" hidden><div class="field"><label for="app-denial-reason">Reason for denial</label><textarea id="app-denial-reason" maxlength="1000" rows="3" placeholder="Explain what could not be verified"></textarea></div><button type="button" class="btn btn-danger" id="app-confirm-denial">Confirm denial</button></div>':
    '<p class="application-reviewed-note">Reviewed: '+date(a.reviewed_at)+'</p>'+(a.review_note?'<p class="application-reviewed-note">Reason: '+escape(a.review_note)+'</p>':"")+(a.status==="approved"?'<p class="application-reviewed-note">Setup email: '+(a.setup_email_sent_at?date(a.setup_email_sent_at):"Not sent yet")+'</p><button type="button" class="btn btn-outline" id="app-resend">Resend setup email</button>':""))+
   '<div class="application-message" id="app-review-message" role="alert" hidden></div></aside><section class="application-proof" aria-label="Validation document"><div class="application-proof-heading"><div class="application-document-tabs" id="app-document-tabs"></div><a class="btn btn-outline btn-small" id="app-proof-link" target="_blank" rel="noopener noreferrer" hidden>Open document</a></div><div class="application-proof-pane" id="app-proof-pane"><p>Loading private document…</p></div></section></div>',true);
  root.querySelector("#app-deny")?.addEventListener("click",()=>{root.querySelector("#app-denial-fields").hidden=false;root.querySelector("#app-denial-reason").focus();});
  let busy=false;
  async function decide(action){
   if(busy)return;const reason=root.querySelector("#app-denial-reason")?.value.trim(),errorBox=root.querySelector("#app-review-message");
   if(action==="deny"&&!reason){message(errorBox,"Please explain why the application is being denied.");return;}
   busy=true;root.querySelectorAll(".application-profile button").forEach(b=>b.disabled=true);message(errorBox,"");
   try{
    const result=await invoke("review-account-application",{application_id:a.id,action,reason});
    root.querySelector(".dialog-close").click();
    showToast(result.message||(action==="deny"?"Application denied. No account was created.":result.restored?"Original account restored. Check Barangay Access for any pending handover. Password-setup email sent.":"Account approved. Password-setup email sent."));
    await loadAccountApplications();
    if(typeof loadUsers==="function")await loadUsers();
    if(typeof loadSecretaryAccess==="function")await loadSecretaryAccess();
    if(typeof loadBarangays==="function")await loadBarangays();
   }catch(error){if(root.isConnected){message(errorBox,error.message);root.querySelectorAll(".application-profile button").forEach(b=>b.disabled=false);if(a.provisioned_user_id&&!restoring)root.querySelector("#app-deny").disabled=true;}}
   finally{busy=false;}
  }
  root.querySelector("#app-approve")?.addEventListener("click",()=>decide(restoring?"restore":"approve"));
  root.querySelector("#app-confirm-denial")?.addEventListener("click",()=>decide("deny"));
  root.querySelector("#app-resend")?.addEventListener("click",()=>decide("resend_setup"));
  const documents=[{label:'Appointment letter',path:a.proof_path,type:a.proof_type},...['authentication_of_office','pds'].map(key=>({label:key==='pds'?'PDS (Personal Data Sheet)':'Authentication of office',path:a[key+'_path'],type:a[key+'_type']}))];
  let proofUrl=null, documentSequence=0;
  const tabs=root.querySelector('#app-document-tabs');
  documents.forEach((doc,index)=>{const tab=document.createElement('button');tab.type='button';tab.className='btn btn-outline btn-small';tab.textContent=doc.label;tab.addEventListener('click',()=>previewDocument(index));tabs.appendChild(tab);});
  const proofObserver=new MutationObserver(()=>{if(!root.isConnected){if(proofUrl)ProtectedFiles.release(proofUrl);proofObserver.disconnect();}});
  proofObserver.observe(document.body,{childList:true});
  async function previewDocument(index){
  const selected=documents[index],sequence=++documentSequence;
  tabs.querySelectorAll('button').forEach((tab,i)=>tab.setAttribute('aria-pressed',String(i===index)));
  const pane=root.querySelector('#app-proof-pane'),link=root.querySelector('#app-proof-link');link.hidden=true;pane.textContent='Loading private document…';
  if(proofUrl){ProtectedFiles.release(proofUrl);proofUrl=null;}
  if(!selected.path){pane.textContent=selected.label+' was not included in this older application.';return;}
  try{
   const file=await ProtectedFiles.download("account-application-proofs",selected.path);
   if(!root.isConnected||sequence!==documentSequence)return;
   proofUrl=ProtectedFiles.objectUrl(file);
   const pane=root.querySelector("#app-proof-pane"),link=root.querySelector("#app-proof-link");link.href=proofUrl;link.hidden=false;
   const element=document.createElement(selected.type==="application/pdf"?"iframe":"img");element.src=proofUrl;
   if(element.tagName==="IFRAME"){element.title="Applicant verification document";element.setAttribute("sandbox","allow-same-origin");}
   else element.alt="Proof submitted by "+a.full_name;
   pane.replaceChildren(element);
  }catch(error){if(root.isConnected&&sequence===documentSequence)root.querySelector("#app-proof-pane").textContent=error.message;}
  }
  await previewDocument(0);
 });
})();
