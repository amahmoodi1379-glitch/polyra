import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

/** Empties every table of the test database (never any other database; see global-setup). */
export async function resetDb() {
  const rows = await testDb.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const list = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (list) await testDb.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
