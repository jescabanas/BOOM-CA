(() => {
  let accounts=[],barangays=[],sequence=0,busy=false;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasAccess=account=>account.is_active&&!account.access_blocked&&!account.access_removed_at;
  function render(){
    const search=document.getElementById('secretary-access-search').value.trim().toLowerCase();
    const filter=document.getElementById('secretary-access-filter').value;
    const rows=barangays.flatMap(barangay=>{
      const assigned=accounts.filter(a=>a.barangay_id===barangay.id);
      return assigned.length?assigned.map(a=>({...a,barangay_name:barangay.name})):[{barangay_id:barangay.id,barangay_name:barangay.name}];
    }).concat(accounts.filter(a=>!barangays.some(b=>b.id===a.barangay_id)));
    const visible=rows.filter(a=>(filter==='all'||(filter==='active'?hasAccess(a):!hasAccess(a)))&&[a.full_name,a.email,a.barangay_name].some(value=>String(value||'').toLowerCase().includes(search)))
      .sort((a,b)=>String(a.barangay_name||'Unassigned').localeCompare(String(b.barangay_name||'Unassigned'),undefined,{numeric:true,sensitivity:'base'})||Number(b.is_active)-Number(a.is_active)||String(a.full_name).localeCompare(String(b.full_name)));
    document.getElementById('secretary-access-body').innerHTML=visible.map(a=>`<tr><td><strong>${escape(a.barangay_name||'Unassigned')}</strong></td><td>${escape(a.full_name||'No assigned secretary')}</td><td>${escape(a.email||'—')}</td><td><span class="pill ${hasAccess(a)?'success':a.access_blocked?'warning':'neutral'}">${hasAccess(a)?'Accessed':a.access_removed_at?'Removed':a.access_blocked?'Security reset blocked':'No access'}</span></td><td><div class="secretary-access-actions">${a.id&&a.is_active?`<button type="button" class="btn btn-outline btn-small" data-secretary-password="${escape(a.id)}">Change password</button>`:''}${a.barangay_id?`<button type="button" class="btn btn-outline btn-small" data-secretary-assign="${escape(a.barangay_id)}">Assign replacement</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="5">No secretary accounts match this view.</td></tr>';
    const activeCount=accounts.filter(hasAccess).length;
    document.getElementById('secretary-access-summary').textContent=activeCount+' secretary account'+(activeCount===1?'':'s')+' with dashboard access';
  }
  window.loadSecretaryAccess=async()=>{
    const current=++sequence,refresh=document.getElementById('secretary-access-refresh');refresh.disabled=true;
    try{
      const [users,bars]=await Promise.all([supabaseClient.rpc('list_secretary_access'),supabaseClient.from('barangays').select('id,name,is_active').order('name')]);
      if(current!==sequence)return;
      if(users.error||bars.error)throw new Error('Could not load secretary access. Please refresh or contact the system administrator.');
      accounts=Array.isArray(users.data)?users.data.filter(a=>!a.access_removed_at):[];barangays=bars.data||[];render();
    }catch(error){if(current===sequence){document.getElementById('secretary-access-body').innerHTML='<tr><td colspan="5">Secretary access could not load. Please refresh.</td></tr>';showToast(error.message);}}
    finally{if(current===sequence)refresh.disabled=false;}
  };
  async function refreshViews(){await Promise.all([loadSecretaryAccess(),loadUsers(),loadBarangays(),loadAudit()]);}
  async function performAccess(action,account,reason){
    const {data,error}=await supabaseClient.rpc('manage_secretary_access',{p_barangay_id:account.barangay_id,p_user_id:account.id,p_action:action,p_reason:reason.trim()});
    if(error||!data?.success)throw new Error(error?.message||'Access could not be updated.');
    showToast(action==='remove'?'Access removed. Previous sessions are blocked; files and submissions are preserved.':'Replacement assigned. Previous secretary access is removed; barangay files and submissions are preserved.');
    await refreshViews();
  }
  async function assignReplacement(initialBarangay=''){
    const eligibleBars=barangays.filter(b=>b.is_active);
    if(!eligibleBars.length)return showToast('No active barangays are available.');
    const pending=showAdminForm('Assign replacement secretary',[
      {name:'barangay',label:'Barangay',value:initialBarangay||eligibleBars[0].id,required:true,options:eligibleBars.map(b=>({value:b.id,label:b.name}))},
      {name:'secretary',label:'Replacement account',required:true,options:[{value:'',label:'Select an approved secretary account'}]},
      {name:'reason',label:'Reason for handover',type:'textarea',required:true,minLength:10,maxLength:1000}
    ],'The selected account becomes the barangay’s secretary. Existing secretary access is removed, and all files and submission history remain.');
    const dialog=document.querySelector('dialog.admin-edit-dialog'),barSelect=dialog.querySelector('#admin-edit-barangay'),accountSelect=dialog.querySelector('#admin-edit-secretary');
    const hint=document.createElement('p');hint.className='field-hint';accountSelect.parentElement.append(hint);
    const sync=()=>{
      const choices=accounts.filter(a=>a.barangay_id===barSelect.value&&!a.is_active&&!a.access_blocked&&!a.access_removed_at);
      accountSelect.replaceChildren(new Option('Select a replacement account',''),...choices.map(a=>new Option(a.full_name+' · '+a.email,a.id)));
      hint.textContent=choices.length?'Choose an approved account without current access.':'No replacement account is ready. Approve their Account Application first, then return here.';
      dialog.querySelector('button[type="submit"]').disabled=!choices.length;
    };
    barSelect.addEventListener('change',sync);sync();
    const values=await pending;if(!values)return;
    const account=accounts.find(a=>a.id===values.secretary&&a.barangay_id===values.barangay);
    if(!account)throw new Error('Refresh and select a replacement account.');
    await performAccess('assign',account,values.reason);
  }
  async function changePassword(id){
    const account=accounts.find(a=>a.id===id);if(!account)return;
    const values=await showAdminForm('Change secretary password',[
      {name:'password',label:'New password',type:'password',required:true,minLength:12,maxLength:128},
      {name:'confirmation',label:'Confirm new password',type:'password',required:true,minLength:12,maxLength:128},
      {name:'reason',label:'Reason for password change',type:'textarea',required:true,minLength:10,maxLength:1000}
    ],`Change the password for ${account.email}. Previous sessions will be blocked. Share the new password securely with the authorized secretary. The account keeps its existing authenticator.`);
    if(!values)return;
    if(values.password!==values.confirmation)return showToast('Passwords must match.');
    const body={user_id:id,password:values.password,reason:values.reason};values.password=values.confirmation='';
    try{
      const {data,error}=await supabaseClient.functions.invoke('change-secretary-password',{body});
      if(error||!data?.success){let message=data?.error;if(!message&&error?.context?.json){try{message=(await error.context.json()).error;}catch{}}throw new Error(message||'Password change failed. Refresh to check whether this account is blocked.');}
      showToast(data.message);await refreshViews();
    }finally{body.password='';await loadSecretaryAccess();}
  }
  async function run(task){if(busy)return;busy=true;try{await task();}catch(error){showToast(error.message);}finally{busy=false;}}
  document.getElementById('secretary-access-search').addEventListener('input',render);
  document.getElementById('secretary-access-filter').addEventListener('change',render);
  document.getElementById('secretary-access-refresh').addEventListener('click',()=>loadSecretaryAccess());
  document.getElementById('secretary-assign').addEventListener('click',()=>run(()=>assignReplacement()));
  document.getElementById('secretary-access-body').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.secretaryAssign)run(()=>assignReplacement(button.dataset.secretaryAssign));
    else if(button.dataset.secretaryPassword)run(()=>changePassword(button.dataset.secretaryPassword));
  });
})();
