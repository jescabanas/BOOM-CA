import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { requireMfaRequest } from "./mfa-authorization.ts";
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
export const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
export const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export const uuid = (value:unknown) => typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function setupRedirect(value:unknown) {
 const allowed = (Deno.env.get("ACCOUNT_APPLICATION_REDIRECT_URLS") || "https://dilgtest2.netlify.app/reset-password.html,http://localhost:5500/DILGtest2/frontend/reset-password.html,http://127.0.0.1:5500/DILGtest2/frontend/reset-password.html,http://localhost:8888/reset-password.html").split(",").map(v=>v.trim());
 return typeof value==="string" && allowed.includes(value) ? value : "https://dilgtest2.netlify.app/reset-password.html";
}
export async function boundedForm(req:Request) {
 const limit=31*1024*1024;
 if (Number(req.headers.get("content-length"))>limit) throw new Error("Each of the three documents must be 10 MB or smaller.");
 if (!req.body) throw new Error("Application form is required.");
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error("Each of the three documents must be 10 MB or smaller.");}chunks.push(value);}
 return new Response(new Blob(chunks),{headers:{"content-type":req.headers.get("content-type")||""}}).formData();
}
export async function proofType(file:File) {
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 if (bytes.length>=5 && new TextDecoder().decode(bytes.slice(0,5))==="%PDF-") return {mime:"application/pdf",ext:"pdf"};
 if (bytes.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return {mime:"image/png",ext:"png"};
 if (bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {mime:"image/jpeg",ext:"jpg"};
 throw new Error("Choose a valid PDF, PNG or JPG document.");
}
export async function activeAdmin(req:Request,db:ReturnType<typeof admin>) {
 if (await requireMfaRequest(req)) return null;
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 const {data,error}=await db.auth.getUser(token);
 if(error||!data.user) return null;
 const {data:profile,error:profileError}=await db.from("profiles").select("id,role,is_active").eq("id",data.user.id).single();
 return !profileError&&profile?.role==="super_admin"&&profile.is_active ? profile : null;
}
