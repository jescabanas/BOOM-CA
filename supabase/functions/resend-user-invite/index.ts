import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { requireMfaRequest } from "../_shared/mfa-authorization.ts";

import { sendAccountEmail } from "../_shared/account-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM");
const EMAIL_FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") || "Lucena City Barangay Compliance System";
const RESET_URL = "https://dilgtest2.netlify.app/reset-password.html";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BREVO_API_KEY || !EMAIL_FROM) return json({ error: "Email delivery is not configured." }, 503);

  const mfaDenied = await requireMfaRequest(req);
  if (mfaDenied) return mfaDenied;
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const caller = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authorization } } });
    const { data: callerData, error: callerError } = await caller.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerData.user.id).single();
    if (callerProfile?.role !== "super_admin") return json({ error: "Forbidden" }, 403);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id is required" }, 400);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id, full_name, email, is_active").eq("id", user_id).single();
    if (profileError || !profile) return json({ error: "User not found" }, 404);
    if (!profile.is_active) return json({ error: "Reactivate the account before sending a new setup link." }, 409);

    await sendAccountEmail(admin,profile.email,profile.full_name,RESET_URL,"invite");
    return json({ success: true });
  } catch (error) {
    console.error("resend-user-invite failed:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Could not send setup link." }, 500);
  }
});
