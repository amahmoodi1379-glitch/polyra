import "dotenv/config";
import { db } from "@/server/db";
import { demoStatus, loadDemo, removeDemo } from "@/server/content/demo";

/**
 * The French demo for the tester account (DECISIONS.md): `npm run demo -- load`, `npm run demo -- remove`
 * or `npm run demo -- status`.
 */
async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "load") {
    const result = await loadDemo();
    if (result.kind === "already")
      console.log(result.texts + result.speaking > 0 ? `The demo was already loaded; ${result.texts} new texts and ${result.speaking} speaking and writing items were added.` : "The demo is already loaded.");
    else if (result.kind === "has_content") console.log(`French already has ${result.words} other words; the demo was not loaded.`);
    else console.log(`Loaded: ${result.words} words, ${result.sentences} sentences, ${result.units} grammar units, ${result.texts} texts, ${result.phonics} phonics lessons, ${result.speaking} speaking and writing items (approved, tester only).`);
  } else if (command === "remove") {
    const result = await removeDemo();
    console.log(result.removed ? "The demo and the progress made with it were removed." : "There was no demo to remove.");
  } else if (command === "status") {
    const status = await demoStatus();
    console.log(status.loaded ? `Loaded: ${status.words} words, ${status.units} units.` : "Not loaded.");
  } else throw new Error("Usage: npm run demo -- load | remove | status");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
