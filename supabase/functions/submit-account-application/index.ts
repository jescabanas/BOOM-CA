import {admin,cors,json,uuid,setupRedirect,boundedForm,proofType} from "../_shared/account-applications.ts";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const db=admin();
 try{
  if((req.headers.get("content-type")||"").includes("application/json")){
   const body=await req.json();
   if(body.action!=="barangays")return json({error:"Use the application form."},400);
   const {data,error}=await db.from("barangays").select("id,name").eq("is_active",true).order("name");
   if(error)throw error;
   return json({barangays:data});
  }
  const form=await boundedForm(req);
  if(form.get("website"))return json({success:true});
  const full_name=String(form.get("full_name")||"").trim(),email=String(form.get("email")||"").trim().toLowerCase(),barangay_id=String(form.get("barangay_id")||"");
  const consent=form.get("consent");
  if(full_name.length<2||full_name.length>120||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!uuid(barangay_id)||consent!=="true")return json({error:"Enter your full name, valid email and barangay, and accept the verification notice."},400);
  const required=[['appointment_letter','Appointment letter'],['authentication_of_office','Authentication of office'],['pds','PDS (Personal Data Sheet)']];
  const documents=[];
  for(const [key,label] of required){
   const file=form.get(key);
   if(!(file instanceof File)||file.size===0||file.size>10*1024*1024)return json({error:label+" is required. Choose a non-empty PDF, PNG or JPG up to 10 MB."},400);
   documents.push({key,file,type:await proofType(file)});
  }
  const {data:allowed,error:limitError}=await db.rpc("consume_account_application_attempt",{p_email:email});
  if(limitError)throw limitError;
  if(!allowed)return json({error:"Too many application attempts. Please try again later or contact DILG Lucena."},429);
  const {data:barangay,error:barangayError}=await db.from("barangays").select("id").eq("id",barangay_id).eq("is_active",true).maybeSingle();
  if(barangayError)throw barangayError;
  if(!barangay)return json({error:"Choose an active Lucena City barangay."},400);
  // A generic receipt prevents disclosure of existing accounts or applications.
  const receipt={success:true,message:"Your request has been received. If eligible, DILG will review your application and email the next steps."};
  const [{data:existing,error:existingError},{data:account,error:accountError}]=await Promise.all([
   db.from("account_applications").select("id").eq("email",email).in("status",["pending","approving"]).maybeSingle(),
   db.rpc("secretary_application_account",{p_email:email})
  ]);
  if(existingError||accountError)throw existingError||accountError;
  if(existing||!account?.eligible)return json(receipt);
  const id=crypto.randomUUID(),uploaded:string[]=[],record:Record<string,unknown>={id,full_name,email,barangay_id,restoration_user_id:account.restoration_user_id||null,setup_redirect:setupRedirect(form.get("setup_redirect"))};
  try{
   for(const {key,file,type} of documents){
    const path=id+"/"+key+"."+type.ext;
    const {error}=await db.storage.from("account-application-proofs").upload(path,file,{contentType:type.mime,upsert:false});
    if(error)throw error;
    uploaded.push(path);
    const prefix=key==='appointment_letter'?'proof':key;
    record[prefix+'_path']=path;
    record[prefix+'_name']=(file.name.replace(/[\x00-\x1f]/g,"").replace(/\.[^.]+$/,"").slice(0,175)||key)+"."+type.ext;
    record[prefix+'_type']=type.mime;record[prefix+'_size']=file.size;
   }
   const {error}=await db.from("account_applications").insert(record);
   if(error)throw error;
  }catch(error){
   if(uploaded.length)await db.storage.from("account-application-proofs").remove(uploaded);
   if((error as {code?:string})?.code==='23505')return json(receipt);
   throw error;
  }
  return json(receipt);
 }catch(error){
  const message=error instanceof Error?error.message:"";
  if(/10 MB|valid PDF|Application form/.test(message))return json({error:message},400);
  console.error("Application submission failed",message);
  return json({error:"Your application could not be submitted. Please try again."},500);
 }
});
