DO $$ BEGIN
  ALTER TYPE initial_autodraft_lookback ADD VALUE IF NOT EXISTS '2d';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE initial_autodraft_lookback ADD VALUE IF NOT EXISTS '4d';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE initial_autodraft_lookback ADD VALUE IF NOT EXISTS '5d';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE user_settings
ALTER COLUMN initial_autodraft_lookback SET DEFAULT '1d';

UPDATE user_settings
SET initial_autodraft_lookback = CASE
  WHEN initial_autodraft_lookback::text = 'none' THEN '1d'::initial_autodraft_lookback
  WHEN initial_autodraft_lookback::text = '7d' THEN '5d'::initial_autodraft_lookback
  WHEN initial_autodraft_lookback::text = '14d' THEN '5d'::initial_autodraft_lookback
  WHEN initial_autodraft_lookback::text = '30d' THEN '5d'::initial_autodraft_lookback
  ELSE initial_autodraft_lookback
END
WHERE initial_autodraft_lookback::text IN ('none', '7d', '14d', '30d');
