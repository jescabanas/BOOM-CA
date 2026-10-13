// MFA-verified Super Administrators can invite new accounts or explicitly
// restore inactive identities. Existing active accounts are never overwritten.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { authorizeSystemRequest } from "../_shared/mfa-authorization.ts";
import { sendAccountEmail } from "../_shared/account-email.ts";
import { setupRedirect } from "../_shared/account-applications.ts";
import { inviteSystemUser } from "../_shared/user-invitation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await authorizeSystemRequest(req, ["super_admin"]);
    if (!actor) return json({ error: "An active Super Administrator with MFA verification is required." }, 403);
    const input = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const result = await inviteSystemUser(admin, actor.id, input, sendAccountEmail, setupRedirect);
    return json(result.body, result.status);
  } catch {
    return json({ error: "The invitation could not be completed. Please try again." }, 500);
  }
});
