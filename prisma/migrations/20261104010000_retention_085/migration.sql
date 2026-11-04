-- The owner chose a target retention of 0.85 (DECISIONS.md, 4 November 2026). A server that still has the
-- old default 0.9 moves to 0.85; a value a teacher set by hand stays. The seed writes the new default.
UPDATE "engine_setting"
SET "value" = '0.85'::jsonb, "default_value" = '0.85'::jsonb, "updated_at" = now()
WHERE "key" = 'fsrs.request_retention' AND "value" = '0.9'::jsonb;
