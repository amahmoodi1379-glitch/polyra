-- Step 1 of the four-step path is done once the prompt is copied; the chatbot picker is gone.
ALTER TABLE "import_batch" ADD COLUMN "prompt_copied_at" TIMESTAMPTZ(3);
-- Batches that already had a chatbot saved had their prompt copied.
UPDATE "import_batch" SET "prompt_copied_at" = "updated_at" WHERE "model_name" IS NOT NULL;
-- The chatbot names list is gone with the picker.
DELETE FROM "app_setting" WHERE "key" = 'chatbot_names';
