import { admin, cors, json, uuid } from "../_shared/account-applications.ts";
import { authorizeSystemRequest } from "../_shared/mfa-authorization.ts";
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  let started=false;
  try{
    const actor=await authorizeSystemRequest(req,['super_admin']);
    if(!actor)return json({error:'Verified Super Administrator required'},403);
    if(Number(req.headers.get('content-length'))>4096)return json({error:'Invalid request'},400);
    const {user_id,password,reason}=await req.json();
    if(!uuid(user_id)||user_id===actor.id||typeof reason!=='string'||reason.trim().length<10||reason.trim().length>1000)
      return json({error:'Select a secretary and enter a reason of 10–1000 characters.'},400);
    if(typeof password!=='string'||password.length<12||password.length>128||!/\S/.test(password))
      return json({error:'Use a new password of 12–128 characters.'},400);
    const db=admin();
    const {data:operation,error:beginError}=await db.rpc('begin_secretary_password_change',{p_user_id:user_id,p_actor_id:actor.id,p_reason:reason.trim()});
    if(beginError)return json({error:'Password change could not start. Ensure this secretary is active and no security reset is running.'},409);
    started=true;
    const {error:passwordError}=await db.auth.admin.updateUserById(user_id,{password});
    if(passwordError)throw new Error('Password provider rejected the update');
    const {error:finishError}=await db.rpc('complete_secretary_password_change',{p_user_id:user_id,p_actor_id:actor.id,p_operation_id:operation});
    if(finishError)throw new Error('Password operation could not complete');
    return json({success:true,message:'Password changed. Previous sessions are blocked. The secretary must sign in with the new password and verify their authenticator.'});
  }catch{
    // Never print request bodies, passwords, provider responses or Auth user data.
    return json({error:started?'The password change did not complete. Protected access remains blocked. Retry after five minutes or remove this account’s access.':'Password change unavailable. Please try again.'},503);
  }
});
