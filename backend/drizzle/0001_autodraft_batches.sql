ALTER TABLE draft_replies
ADD COLUMN IF NOT EXISTS autodraft_batch_id text;
