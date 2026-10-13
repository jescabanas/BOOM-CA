import {admin,cors,json,uuid,setupRedirect,activeAdmin} from "../_shared/account-applications.ts";
import { sendAccountEmail } from "../_shared/account-email.ts";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const db=admin();let claimedId:string|null=null,restoring=false;
 try{
  const reviewer=await activeAdmin(req,db);
  if(!reviewer)return json({error:"An active Super Administrator account is required."},403);
  const {application_id,action,reason}=await req.json();
  if(!uuid(application_id)||!["approve","restore","deny","resend_setup"].includes(action))return json({error:"Invalid review request."},400);
  const {data:a,error:readError}=await db.from("account_applications").select("*").eq("id",application_id).single();
  if(readError||!a)return json({error:"Application not found."},404);
  if(action==="restore"&&!a.restoration_user_id)return json({error:"This application is for a new account. Use Approve & create account."},409);
  if(action==="restore"&&a.status==="approved")return json({error:"This application was already approved. Use Resend setup email if needed."},409);
  if(action==="approve"&&a.restoration_user_id)return json({error:"This application restores a removed secretary. Use Approve & restore account."},409);
  restoring=!!a.restoration_user_id;
  if(action==="deny"){
   const note=typeof reason==="string"?reason.trim():"";
   if(!note||note.length>1000)return json({error:"Enter a denial reason (up to 1,000 characters)."},400);
   if(a.provisioned_user_id&&!restoring)return json({error:"Account creation has started. Retry approval; this application cannot be denied now."},409);
   let denial=db.from("account_applications").update({status:"denied",review_note:note,reviewed_by:reviewer.id,reviewed_at:new Date().toISOString()}).eq("id",a.id).eq("status","pending");
   denial=a.provisioned_user_id?denial.eq("provisioned_user_id",a.provisioned_user_id):denial.is("provisioned_user_id",null);
   const {data:changed,error}=await denial.select("id").maybeSingle();
   if(error)throw error;if(!changed)return json({error:"This application has already been reviewed or is being processed."},409);
   await db.rpc("log_audit_event",{p_user_id:reviewer.id,p_action:"ACCOUNT_APPLICATION_DENIED",p_entity_table:"account_applications",p_entity_id:a.id,p_metadata:{reason:note}});
   return json({success:true,status:"denied"});
  }
  if(action==="resend_setup"&&a.status!=="approved")return json({error:"Approve this application first."},409);
  if(["approve","restore"].includes(action)&&a.status!=="approved"){
   if(a.status==="denied")return json({error:"This application was denied."},409);
   let claim=db.from("account_applications").update({status:"approving",processing_at:new Date().toISOString()}).eq("id",a.id).eq("status",a.status);
   if(a.status==="approving"){
    if(!a.processing_at||Date.now()-Date.parse(a.processing_at)<5*60*1000)return json({error:"Another approval is in progress. Refresh shortly."},409);
    claim=claim.eq("processing_at",a.processing_at);
   }
   const {data:claimed,error:claimError}=await claim.select("id").maybeSingle();
   if(claimError)throw claimError;if(!claimed)return json({error:"Another administrator is reviewing this application."},409);
   claimedId=a.id;
   let userId=a.provisioned_user_id;
   if(!a.provisioned_user_id){
    let createdHere=false;
    if(restoring){userId=a.restoration_user_id;}
    else{
     const {data:created,error:createError}=await db.auth.admin.createUser({email:a.email,password:crypto.randomUUID()+crypto.randomUUID(),email_confirm:true,user_metadata:{full_name:a.full_name}});
     if(createError)throw createError;
     userId=created.user.id;createdHere=true;
    }
    const {error:saveError}=await db.from("account_applications").update({provisioned_user_id:userId}).eq("id",a.id).eq("status","approving");
    if(saveError){
     // Roll back only the new account created in this request, never an existing user.
     if(createdHere)await db.auth.admin.deleteUser(userId);
     throw saveError;
    }
   }
   const {data:verified,error:verifyError}=await db.auth.admin.getUserById(userId);
   if(verifyError||verified?.user?.email?.toLowerCase()!==a.email)throw new Error("Provisioned account does not match the application.");
   const {error:finalizeError}=await db.rpc("finalize_account_application",{p_application_id:a.id,p_reviewer_id:reviewer.id});
   if(finalizeError)throw finalizeError;
   claimedId=null;
  }
  // Password creation is performed by the applicant through a verified recovery email.
  // No applicant password is collected, stored in application records or shown to staff.
  try { await sendAccountEmail(db,a.email,a.full_name,setupRedirect(a.setup_redirect),"invite"); }
  catch { return json({success:true,status:"approved",restored:restoring,email_sent:false,message:"Account approved, but the setup email could not be sent. Use Resend setup email."}); }
  const {error:stampError}=await db.from("account_applications").update({setup_email_sent_at:new Date().toISOString()}).eq("id",a.id).eq("status","approved");
  if(stampError)console.error("Setup email timestamp update failed",stampError.message);
  return json({success:true,status:"approved",restored:restoring,email_sent:true});
 }catch(error){
  if(claimedId)await db.from("account_applications").update({status:"pending",processing_at:null}).eq("id",claimedId).eq("status","approving");
  console.error("Application review failed",error instanceof Error?error.message:"unknown");
  return json({error:restoring?"Restoration could not be completed. The original account remains unchanged. Check that it is still a removed secretary and has no pending security reset, then retry approval.":"Approval could not be completed. No existing account was changed. If this email already has an account, deny the duplicate request; otherwise retry approval."},500);
 }
});
