import { admin, cors, json, setupRedirect } from "../_shared/account-applications.ts";
import { sendAccountEmail } from "../_shared/account-email.ts";
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  try {
    if (Number(req.headers.get("content-length")) > 2048) return json({error:"Invalid request"},400);
    const {email,redirect_to} = await req.json();
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"Enter a valid email address."},400);
    const normalized = email.trim().toLowerCase(), db = admin();
    const {data:allowed,error:limitError} = await db.rpc("consume_auth_email_attempt",{p_email:normalized});
    if (limitError) throw limitError;
    if (!allowed) return json({error:"Please wait one minute before requesting another email."},429);
    const {data:profile,error} = await db.from("profiles").select("full_name,email").eq("email",normalized).eq("is_active",true).maybeSingle();
    if (error) throw error;
    if (profile) await sendAccountEmail(db,profile.email,profile.full_name,setupRedirect(redirect_to),"recovery");
    return json({success:true,message:"If an active account exists for this address, a password reset email will be sent."});
  } catch {
    return json({error:"Password reset email could not be requested. Please try again later."},503);
  }
});
