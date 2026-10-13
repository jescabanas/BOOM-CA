-- Email-code second-step verification. Codes are never exposed through the
-- database to clients: only their SHA-256 hash is retained by the backend.
create table email_mfa_challenges (
  user_id uuid primary key references profiles(id) on delete cascade,
  code_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table email_mfa_challenges enable row level security;

-- No client policies: the request, verification, and status Edge Functions
-- use the service role after validating the caller's user JWT.
