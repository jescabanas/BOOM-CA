import { admin, cors, json, uuid } from "../_shared/account-applications.ts";
import { authorizeSystemRequest } from "../_shared/mfa-authorization.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" },405);
  try {
    const actor = await authorizeSystemRequest(req,["super_admin"]);
    if (!actor) return json({ error: "An active, MFA-verified Super Administrator is required." },403);
    const { user_id, reason } = await req.json();
    if (!uuid(user_id) || user_id === actor.id || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1000)
      return json({ error: "Choose another user and record the identity-check/ticket reason (10–1000 characters)." },400);
    const db = admin();
    const { data: operation, error: beginError } = await db.rpc("begin_mfa_reset",{ p_user_id:user_id,p_actor_id:actor.id,p_reason:reason.trim() });
    if (beginError) return json({ error: "Reset could not start. If a reset is already running, wait five minutes and retry." },409);
    // The target is now blocked. Partial failures never re-enable old sessions.
    const { data, error } = await db.auth.admin.mfa.listFactors({ userId:user_id });
    if (error) throw error;
    for (const factor of data.factors) {
      const result = await db.auth.admin.mfa.deleteFactor({ userId:user_id,id:factor.id });
      if (result.error) throw result.error;
    }
    const { error: finishError } = await db.rpc("complete_mfa_reset",{ p_user_id:user_id,p_actor_id:actor.id,p_operation_id:operation });
    if (finishError) throw finishError;
    return json({ success:true,message:"Authenticator reset. If the user forgot their password, use Resend setup email. They will save a new password, scan and verify their new authenticator, then sign in again. Otherwise they can sign in to set up a new authenticator." });
  } catch {
    return json({ error:"Reset was not completed. The account remains blocked if reset started. Confirm identity and retry after five minutes; contact the project owner if it persists." },503);
  }
});
