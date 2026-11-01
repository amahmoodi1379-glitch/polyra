-- «بعداً» turned the phonics rounds off; the next finished session says so once (PRD §3.11 row 5, §8.4).
ALTER TABLE "enrollment" ADD COLUMN "phonics_off_due" BOOLEAN NOT NULL DEFAULT false;
