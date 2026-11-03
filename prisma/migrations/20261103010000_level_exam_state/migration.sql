-- A level exam runs over several answers (PRD §11.6): its state while it runs, and when it ended.
ALTER TABLE "level_exam" ADD COLUMN "state" JSONB;
ALTER TABLE "level_exam" ADD COLUMN "finished_at" TIMESTAMPTZ(3);
