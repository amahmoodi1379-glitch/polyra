-- The demo loader saved its batch reports without the round count and the notes list, so their batch pages failed to open.
UPDATE "import_batch" SET "report" = jsonb_build_object('rounds', 1, 'issues', '[]'::jsonb) || "report"
WHERE "report" IS NOT NULL AND NOT ("report" ? 'issues');
