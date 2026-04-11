ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS drafting_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE user_settings
SET drafting_rules = COALESCE(drafting_rules, '[]'::jsonb)
WHERE drafting_rules IS NULL;
