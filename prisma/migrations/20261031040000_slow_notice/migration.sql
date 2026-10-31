-- Pace went to slow and no finished session has said so yet (PRD §3.11 row 6).
ALTER TABLE "enrollment" ADD COLUMN "slow_notice_due" BOOLEAN NOT NULL DEFAULT false;
