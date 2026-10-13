// notify
// Sends a notification + (optionally) triggers an email via a transactional
// email provider webhook. Called from the frontend for actions that need an
// immediate push (in addition to the DB triggers that create in-app rows).
// Kept separate from DB triggers because outbound email/SMS calls should
// never block a Postgres transaction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { requireMfaRequest } from "../_shared/mfa-authorization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Set this in your Supabase project's Edge Function secrets if you wire up
// an email provider (Resend, Postmark, SendGrid, etc.)
const EMAIL_WEBHOOK_URL = Deno.env.get("EMAIL_WEBHOOK_URL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const mfaDenied = await requireMfaRequest(req);
  if (mfaDenied) return mfaDenied;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { recipient_id, type, title, message, submission_id, send_email } = await req.json();

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await adminClient.rpc("notify_user", {
      p_recipient: recipient_id,
      p_type: type,
      p_title: title,
      p_message: message,
      p_submission_id: submission_id ?? null,
    });

    if (send_email && EMAIL_WEBHOOK_URL) {
      const { data: recipientProfile } = await adminClient
        .from("profiles")
        .select("email, full_name")
        .eq("id", recipient_id)
        .single();

      if (recipientProfile?.email) {
        await fetch(EMAIL_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipientProfile.email,
            subject: title,
            body: message,
          }),
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
