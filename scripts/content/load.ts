import "dotenv/config";
import { db } from "@/server/db";
import type { LanguageCode } from "@/server/content/languages";
import { loadPacks } from "@/server/content/packs/load";

/**
 * Loads the content packs (content/<language>/) into the database: what is new since the last load,
 * through the panel's importers, approved and published when ready (src/server/content/packs/load.ts).
 * The server runs it at every start (docker-entrypoint.sh; CONTENT_PACKS=off turns that off).
 *
 *   npm run content:load            (both languages)
 *   npm run content:load -- de
 */
async function main() {
  const languages = process.argv.slice(2).filter((arg): arg is LanguageCode => arg === "fr" || arg === "de");
  const started = Date.now();
  await loadPacks({ languages: languages.length ? languages : undefined, log: (line) => console.log(`[content] ${line}`) });
  console.log(`[content] done in ${Math.round((Date.now() - started) / 1000)} s`);
}

main()
  .catch((error) => {
    console.error("[content] the content packs were not loaded:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
