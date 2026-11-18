import "dotenv/config";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { backupClient, backupName, backupStream } from "@/server/backup/file";
import { checkBackup, restoreBackup } from "@/server/backup/restore";

/**
 * Full backup from the command line (the panel has the same in «خروجی و ورود فایل»):
 * `npm run backup -- save [file]`, `npm run backup -- check <file>`, `npm run backup -- restore <file> --yes`.
 * Restore replaces everything in DATABASE_URL and adds the audio files to STORAGE_DIR.
 */
async function main() {
  const [command, file, flag] = process.argv.slice(2);
  if (command === "save") {
    const now = new Date();
    const target = file ?? backupName(now);
    await pipeline(backupStream(now), createWriteStream(target, { flags: "wx" }));
    console.log(`Saved ${target}`);
  } else if (command === "check" && file) {
    const client = await backupClient();
    try {
      console.log(JSON.stringify(await checkBackup(file, client), null, 2));
    } finally {
      await client.end();
    }
  } else if (command === "restore" && file) {
    if (flag !== "--yes") throw new Error("Restore replaces every table of DATABASE_URL. Add --yes to go ahead.");
    const result = await restoreBackup(file);
    console.log(`Restored ${result.rows} rows and ${result.files} files.`);
  } else throw new Error("Usage: npm run backup -- save [file] | check <file> | restore <file> --yes");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
