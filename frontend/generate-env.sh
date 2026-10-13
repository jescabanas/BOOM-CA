#!/bin/sh
# Generates frontend/env.js from Netlify environment variables at build time.
# Referenced by netlify.toml's build.command.
set -e

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "SUPABASE_URL or SUPABASE_ANON_KEY is not set; retaining env.js"
  exit 0
fi

cat > env.js <<EOF
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}"
};
EOF

echo "Generated env.js"
