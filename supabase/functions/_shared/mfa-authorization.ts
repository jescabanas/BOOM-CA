import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

// Pure decision seam used by tests. Claims MUST come from an already verified
// Supabase JWT, never from unverified client metadata.
export function mfaAuthorized(account: any, claims: any, userId: string) {
  return !!account && account.id === userId && !!account.is_active && !account.blocked
    && !!account.access_allowed && (!account.mfa_required || claims.aal === "aal2");
}
export async function authorizeSystemRequest(req: Request, roles?: string[]) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.split(".").length !== 3) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Cryptographic/expiry verification comes BEFORE decoding any claims.
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) return null;
  const payload = token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  const claims = JSON.parse(atob(payload));
  if (claims.sub !== userData.user.id) return null;
  const { data: account, error } = await client.rpc("mfa_bootstrap");
  if (error || !mfaAuthorized(account, claims, userData.user.id)) return null;
  if (!["super_admin", "barangay_secretary"].includes(account.role)) return null;
  if (roles && !roles.includes(account.role)) return null;
  return account;
}
export async function requireMfaRequest(req: Request) {
  try {
    if (await authorizeSystemRequest(req)) return null;
  } catch { /* Fail closed on malformed tokens and provider/database outages. */ }
  return new Response(JSON.stringify({ error: "MFA verification and an active account are required.", code: "MFA_REQUIRED" }), {
    status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
