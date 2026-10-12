import "dotenv/config";
import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";

/**
 * Makes the first admin (PRD §13.1): `npm run make-admin -- 09121234567 fr`.
 * Later admins are added from the panel. The second argument is the admin's own language.
 */
async function main() {
  const [rawPhone, language = "fr"] = process.argv.slice(2);
  const phone = rawPhone ? normalizeMobile(rawPhone) : null;
  if (!phone) throw new Error("Usage: npm run make-admin -- 09121234567 [fr|de]");
  if (!["fr", "de"].includes(language)) throw new Error("Language must be fr or de");

  const setting = await db.engineSetting.findUnique({ where: { key: "session.default_length" } });
  const sessionLength = typeof setting?.value === "number" ? setting.value : 15;

  const user = await db.user.upsert({
    where: { phone },
    update: { is_admin: true, admin_language: language },
    create: { phone, is_admin: true, admin_language: language, session_length_min: sessionLength },
  });
  await db.adminLog.create({
    data: { admin_id: null, action: "make_admin", entity: "user", entity_id: String(user.id), after: { is_admin: true } },
  });
  console.log(`${phone} is now an admin (language: ${language}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
