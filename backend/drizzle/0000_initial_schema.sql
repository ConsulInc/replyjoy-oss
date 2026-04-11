DO $$ BEGIN
  CREATE TYPE agent_provider AS ENUM ('openai', 'anthropic', 'gemini');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE initial_autodraft_lookback AS ENUM ('none', '1d', '3d', '7d', '14d', '30d');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  clerk_user_id text NOT NULL UNIQUE,
  email text,
  first_name text,
  last_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  system_prompt text NOT NULL DEFAULT 'Draft concise, warm, useful replies.',
  agent_provider agent_provider NOT NULL DEFAULT 'gemini',
  agent_model text NOT NULL DEFAULT 'gemini-3-flash-preview',
  initial_autodraft_lookback initial_autodraft_lookback NOT NULL DEFAULT 'none',
  autodraft_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gmail_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email text,
  google_sub text,
  last_history_id text,
  refresh_token_encrypted text NOT NULL,
  access_token_encrypted text,
  token_expires_at timestamptz,
  scopes text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  sync_status text DEFAULT 'connected',
  last_sync_error text,
  initial_sync_started_at timestamptz,
  initial_sync_completed_at timestamptz,
  last_successful_sync_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS last_history_id text;
ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE TABLE IF NOT EXISTS email_threads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  gmail_history_id text,
  subject text,
  snippet text,
  from_email text,
  from_name text,
  last_message_at timestamptz,
  has_unread boolean DEFAULT false,
  in_primary boolean DEFAULT true,
  selection_status text,
  selection_reason text,
  latest_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, gmail_thread_id)
);

CREATE TABLE IF NOT EXISTS email_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL UNIQUE,
  gmail_internal_date timestamptz,
  direction text,
  from_email text,
  to_emails text,
  cc_emails text,
  subject text,
  text_body text,
  html_body text,
  headers_json jsonb,
  body_loaded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_replies (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_draft_id text,
  status text NOT NULL DEFAULT 'drafted',
  decision_provider agent_provider,
  decision_model text,
  generation_provider agent_provider,
  generation_model text,
  system_prompt_snapshot text,
  selection_context_json jsonb,
  generated_text text NOT NULL,
  source_message_id text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_type text NOT NULL,
  window_start timestamptz,
  window_end timestamptz,
  status text NOT NULL DEFAULT 'pending',
  threads_scanned text DEFAULT '0',
  threads_selected text DEFAULT '0',
  drafts_created text DEFAULT '0',
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
