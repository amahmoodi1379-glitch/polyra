import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // PRD §15.3: the engine is pure functions. It never touches the database, the server code,
    // the app, the network or the clock; time and randomness come in as arguments.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server", "@/server/*", "**/server/*"], message: "The engine must not import server code (PRD §15.3)." },
            { group: ["@/app", "@/app/*", "**/app/*"], message: "The engine must not import app code (PRD §15.3)." },
            { group: ["@/generated/*", "@prisma/*", "prisma", "pg"], message: "The engine must not use the database (PRD §15.3)." },
            { group: ["next", "next/*", "react", "react-dom"], message: "The engine is plain TypeScript." },
            { group: ["node:*", "fs", "path", "http", "https", "crypto"], message: "The engine must not use Node APIs." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The engine must not use the network (PRD §15.3)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Reading the clock is not allowed in the engine; pass the time in (PRD §15.3).",
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Pass a random generator in as an argument (PRD §15.3)." },
        { object: "Date", property: "now", message: "Pass the time in as an argument (PRD §15.3)." },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "design/**", ".claude/**", ".impeccable/**"]),
]);

export default eslintConfig;
