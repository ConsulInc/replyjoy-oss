ALTER TABLE sync_runs
ADD COLUMN IF NOT EXISTS total_cost_usd numeric(12, 8) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS thread_run_results (
  sync_run_id text NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  decision text NOT NULL,
  reason text,
  cost_usd numeric(12, 8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_run_id, thread_id)
);
