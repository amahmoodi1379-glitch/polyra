-- Items loaded from the content packs (DECISIONS.md, 19 Nov 2026).
CREATE TABLE "content_pack_item" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" TEXT NOT NULL,
    "hash" VARCHAR(16) NOT NULL,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pack_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_pack_item_language_kind_key_key" ON "content_pack_item"("language", "kind", "key");
