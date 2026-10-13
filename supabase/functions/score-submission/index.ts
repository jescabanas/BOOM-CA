// score-submission
// Edge Function that recomputes and returns a submission's score.
// The database trigger (apply_submission_score) is the source of truth and
// runs on every insert/update automatically; this endpoint exists for:
//   1) explicit "recalculate now" actions from the evaluator UI
//   2) external integrations that need a scored result without a DB round trip
//
// All authorization is enforced by RLS + role checks below — this function
// never trusts client-supplied scores.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { requireMfaRequest } from "../_shared/mfa-authorization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { data: profile, error: profileErr } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 403 });
    }

    if (!["super_admin"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden: Super Administrator role required" }), {
        status: 403,
      });
    }

    const { submission_id } = await req.json();
    if (!submission_id) {
      return new Response(JSON.stringify({ error: "submission_id is required" }), { status: 400 });
    }

    // Use service role for the actual RPC call so the SECURITY DEFINER
    // scoring function runs with full access, but only after the above
    // auth + role check has already gated this request.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: scoreResult, error: scoreErr } = await adminClient
      .rpc("calculate_submission_score", { p_submission_id: submission_id })
      .single();

    if (scoreErr) {
      return new Response(JSON.stringify({ error: scoreErr.message }), { status: 500 });
    }

    const { error: updateErr } = await adminClient
      .from("submissions")
      .update({
        points_awarded: (scoreResult as any).points,
        score_band: (scoreResult as any).band,
      })
      .eq("id", submission_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }

    await adminClient.rpc("log_audit_event", {
      p_user_id: userData.user.id,
      p_action: "MANUAL_RESCORE",
      p_entity_table: "submissions",
      p_entity_id: submission_id,
      p_metadata: scoreResult,
    });

    return new Response(JSON.stringify({ success: true, score: scoreResult }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
