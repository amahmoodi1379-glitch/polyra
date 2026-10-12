import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { appSettingDefaults } from "@/server/settings/app-catalog";
import { engineCatalog } from "@/server/settings/engine-catalog";

const json = (value: unknown) => (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

/**
 * Brings languages and settings up to date. Safe to run on every deploy: it adds what is missing and
 * refreshes defaults, ranges and descriptions, but never touches a value an admin has set.
 */
export async function seedSettings(db: PrismaClient) {
  for (const code of ["fr", "de"]) {
    await db.language.upsert({ where: { code }, update: {}, create: { code, live: false } });
  }

  for (const def of engineCatalog) {
    const shared = {
      default_value: json(def.default),
      min_value: def.min ?? null,
      max_value: def.max ?? null,
      description_fa: def.description_fa,
    };
    await db.engineSetting.upsert({
      where: { key: def.key },
      update: shared,
      create: { key: def.key, value: json(def.default), ...shared },
    });
  }

  for (const [key, value] of Object.entries(appSettingDefaults)) {
    await db.appSetting.upsert({ where: { key }, update: {}, create: { key, value: json(value) } });
  }

  return { engineSettings: engineCatalog.length, appSettings: Object.keys(appSettingDefaults).length };
}
