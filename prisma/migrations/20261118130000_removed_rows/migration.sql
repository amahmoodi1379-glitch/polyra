-- Rows taken out by one deletion in «همه محتوا», kept so the change log can put them back.
CREATE TABLE "removed_rows" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "removed_rows_pkey" PRIMARY KEY ("id")
);
