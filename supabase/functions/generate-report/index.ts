// generate-report
// Produces CSV exports for staff roles (super_admin).
// Excel/PDF exports are generated client-side (see frontend/js/export.js) from
// the same underlying query results, using SheetJS and a PDF library, to avoid
// bundling heavy binary-format libraries into the Edge Function runtime.
//
// report_type: 'barangay_performance' | 'mandate_compliance' | 'submission_history'
//            | 'late_submissions' | 'rejected_mov' | 'top_performers'
//            | 'bottom_performers' | 'audit_report'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { requireMfaRequest } from "../_shared/mfa-authorization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as any)[h])).join(","));
  }
  return lines.join("\n");
}

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

    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (!profile || !["super_admin"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }

    const { report_type, filters } = await req.json();
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let rows: Record<string, unknown>[] = [];

    switch (report_type) {
      case "barangay_performance": {
        const { data } = await adminClient.from("v_current_leaderboard").select("*");
        rows = data ?? [];
        break;
      }
      case "mandate_compliance": {
        const { data } = await adminClient.from("v_mandate_completion").select("*");
        rows = data ?? [];
        break;
      }
      case "late_submissions": {
        const { data } = await adminClient
          .from("submissions")
          .select("id, barangay_id, mandate_period_id, submitted_at, points_awarded, score_band")
          .eq("score_band", "late");
        rows = data ?? [];
        break;
      }
      case "rejected_mov": {
        const { data } = await adminClient
          .from("submissions")
          .select("id, barangay_id, evaluator_remarks, reviewed_at")
          .eq("status", "rejected");
        rows = data ?? [];
        break;
      }
      case "audit_report": {
        const { data } = await adminClient
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(filters?.limit ?? 1000);
        rows = data ?? [];
        break;
      }
      default: {
        return new Response(JSON.stringify({ error: `Unknown report_type: ${report_type}` }), {
          status: 400,
        });
      }
    }

    const csv = toCSV(rows);

    await adminClient.rpc("log_audit_event", {
      p_user_id: userData.user.id,
      p_action: "REPORT_GENERATED",
      p_entity_table: report_type,
      p_entity_id: null,
      p_metadata: { row_count: rows.length },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${report_type}.csv"`,
      },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
