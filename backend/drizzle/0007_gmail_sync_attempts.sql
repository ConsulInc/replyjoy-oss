ALTER TABLE gmail_accounts
ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;
