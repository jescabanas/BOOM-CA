console.log("SUPABASECLIENT VERSION 1");

const SUPABASE_URL =
  window.__ENV__?.SUPABASE_URL ||
  "https://nptfdsblgsufghdtnjvk.supabase.co";

const SUPABASE_ANON_KEY =
  window.__ENV__?.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wdGZkc2JsZ3N1ZmdoZHRuanZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1OTcwODgsImV4cCI6MjEwMTE3MzA4OH0.soiJjF3NaWM-qCYwQQInPcBeiiBuapiuiS_PDBJIk9s";

if (!window.supabase?.createClient) {
  throw new Error("Supabase client library failed to load.");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

const ROLE_HOME = {
  super_admin: "dashboard.html",
  barangay_secretary: "secretary.html",
  public_user: "public-leaderboard.html",
};

const ROLE_LABEL = {
  super_admin: "Super Administrator",
  barangay_secretary: "Barangay Secretary",
  public_user: "Public User",
};
