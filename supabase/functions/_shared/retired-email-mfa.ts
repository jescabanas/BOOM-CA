// Deploy under the three old email-MFA slugs only after the TOTP frontend is
// available, or delete those hosted functions. This never queries/sends codes.
Deno.serve((req: Request) => new Response(
  req.method === "OPTIONS" ? "ok" : JSON.stringify({ error: "Email MFA is retired. Sign in using the authenticator flow.", code: "EMAIL_MFA_RETIRED" }),
  { status: req.method === "OPTIONS" ? 200 : 410, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  } },
));
