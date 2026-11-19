-- Machine voice made on our own server (DECISIONS.md, 18 Nov 2026).
ALTER TABLE "audio_asset" ADD COLUMN "made_from" TEXT;

CREATE TABLE "audio_declined" (
    "slot" TEXT NOT NULL,
    "made_from" TEXT NOT NULL,
    "declined_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_declined_pkey" PRIMARY KEY ("slot")
);

CREATE TABLE "audio_generator" (
    "id" INTEGER NOT NULL,
    "owner" TEXT,
    "lease_until" TIMESTAMPTZ(3),
    "state" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_generator_pkey" PRIMARY KEY ("id")
);
