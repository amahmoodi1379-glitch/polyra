# Polyra

Persian-language PWA for learning French and German (A1 to B2). The product owner is non-technical:
all coding, testing and deployment is done by Claude Code (PRD §15.9).

## Source of truth
- `docs/PRD.md` — the only reference for product behavior (Persian). Section numbers are cited as §x.y.
- `docs/PLAN.md` — the agreed phase plan.
- `DECISIONS.md` — every decision not covered by the PRD, with date and reason.
- `PROGRESS.md` — current phase, done, in progress, next step, open problems. Read at the start of
  every session, update at the end.

## Rules (PRD §15.8, summarized)
1. Build in the order of `docs/PLAN.md`; a phase starts only after the previous one's exit condition.
2. Table and field names follow PRD §4 exactly, except where `DECISIONS.md` records a change.
3. Every rule in PRD §9–11 has a unit test; tests T01–T110 keep their codes.
4. If the PRD is silent or contradicts itself: do not guess. Ask the owner in simple Persian with
   closed options and a recommendation, then record the answer in `DECISIONS.md`.
5. No AI calls inside the app or in any project script. The only exception is TTS in `scripts/audio`.
6. All engine numbers come from `engine_setting` (PRD §9.8). No magic numbers in `src/engine`.
7. Add a library only when truly needed, and only well-known maintained ones. TypeScript only.
8. Every database migration is versioned.
9. No runtime dependency on services outside Iran (fonts, CDNs, analytics are self-hosted).

## Talking to the owner
Simple Persian, no jargon. Ask whenever less than 95% sure, always with a recommendation.
Visual quality and UX are top priority; avoid generic "AI-looking" design. When a custom image
would help, ask the owner to generate it and give a ready-made prompt.

## Design
- Direction: "Jelly". The owner rejected Geometry, Certificate and Tehran modernism and fixed the brand palette
  to six colors: #D81E5B, #A8134A, #F0527F, #FDE7EF, #2B1020, #1FB5A8 (roles in `DECISIONS.md`; wrong answer
  #A8134A, correct #1FB5A8). Start is a shape-shifting WebGL jelly with the "polyra" wordmark in a moving
  gradient and no "شروع" label; it is the only playful element, the rest stays calm. Built on every screen in
  `design/prototypes/polyra-jelly.html`. The design system (tokens, components, motion, rules) is `DESIGN.md`
  with `.impeccable/design.json`; the prototype's contract lives in `.impeccable/surfaces/`. Older prototypes in
  `design/prototypes/` are history. Prototypes load Motion from a CDN and fonts from Google Fonts only because
  they are hosted previews; the app self-hosts everything (rule 9).
- Design skills in `.claude/skills`: `impeccable` (Apache 2.0, from pbakaus/impeccable) for UI craft,
  critique and polish; `motion-design` (MIT, from LottieFiles/motion-design-skill) for timing and easing.
  Use them for every UI task. Build both light and dark themes, RTL and LTR, and respect reduced motion.

## Commands
Local setup: PostgreSQL running, `cp .env.example .env`, `npm install` (also generates the Prisma client),
`npm run db:migrate`, `npm run seed`.

| Command | What it does |
| --- | --- |
| `npm run dev` | App on http://localhost:3000 (learner app at `/`, panel at `/admin`) |
| `npm run lint` / `npm run typecheck` | ESLint (includes the engine-isolation rule) / route types + `tsc` |
| `npm test` | Vitest unit and integration tests (`tests/unit`, `tests/integration`) |
| `npm run test:e2e` | Playwright on phone and desktop sizes; needs `npm run build` first. Starts its own server on the test database (`E2E_DATABASE_URL`, else `TEST_DATABASE_URL`), wiped and seeded each run. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium |
| `npm run db:migrate` | New versioned migration from `prisma/schema.prisma` (development only) |
| `npm run db:deploy` | Apply migrations on a server |
| `npm run seed` | Languages, engine and general settings, one admin and one tester (`SEED_ADMIN_PHONE`, `SEED_TESTER_PHONE`) |
| `npm run make-admin -- 09121234567 fr` | Make a phone an admin (first admin; later ones from the panel) |

## Code map
- `prisma/schema.prisma`: PRD §4. Models are PascalCase, tables and columns keep the PRD names.
- `src/engine`: pure functions (PRD §15.3). `src/server`: database, auth, SMS, storage, settings.
- `src/server/settings/engine-catalog.ts`: every §9.8 key with default, range and Persian description.
  `engine-rules.ts` checks a value and the rules between keys (shared by page and server), `engine.ts` saves and
  reverts. `general-fields.ts` lists the «تنظیمات عمومی» fields and their checks, `general.ts` stores them,
  `history.ts` writes their log lines. Pages: `src/app/admin/settings/{engine,general}`.
- `src/server/auth`: SMS codes (§15.5 limits), devices and the session cookie; `requireAdmin()` guards `/admin`.
- `src/app/login`, `src/app/admin`: login flow and the teacher panel shell (`admin-nav.tsx` holds the menu).
- `src/server/content/library`: «همه محتوا» lists, status changes, edit forms (`edit/`), delete, the change log
  (`log.ts` writes, `history.ts` shows, `revert.ts` puts back). `src/server/content/order.ts`: the «ترتیب» page.
- `src/server/content/publish`: «انتشار» (PRD §13.5). `checks.ts` holds every type's publish conditions,
  `run.ts` publishes the ready ones with their child rows, `levels.ts` the level checklist, level release and language live.
- Audio (PRD §13.8; the phone's voice reads anything without a file). `src/lib/audio`: the file format, loudness and
  mp3 (shared by browser and server). `src/server/content/audio`: `slots.ts` (keys like `word:12`, `phonics:3:pair-a:0`),
  `store.ts` (save, remove, heard, text sync and join), `view.ts`, `lists.ts` (the `/admin/audio` tabs), `match.ts`
  (bulk upload names). `src/components/admin/audio`: player, recorder, browser preparation (a Web Worker), slot
  controls, text sync. Files are stored on disk by `src/server/storage.ts` and served from `/media`.
- Errors (PRD §15.9): `src/server/errors.ts` `logError()` stores a row and returns its short code (`src/lib/error-code.ts`;
  repeats share the code). `src/instrumentation.ts` sends uncaught server errors there through `src/server/request-error.ts` (render errors are coded from their
  digest), `src/instrumentation-client.ts` and `src/lib/report-error.ts` send browser errors to `/api/errors`. Error screens:
  `src/components/error-screen.tsx` from `src/app/{error,global-error}.tsx` and `src/app/admin/error.tsx`. The «خطاها» page
  reads `src/server/errors-list.ts`; `src/server/error-report.ts` builds the text copied for Claude Code.
- «سلامت محتوا» (PRD §13.11): `src/server/content/health/usable.ts` is the pure usable-sentence count, `sentences.ts`
  loads it per level; its button opens P-S with `PlanOptions.wordIds`.
- `src/i18n/fa.json`: every Persian interface string; `t("key", vars)` from `@/i18n`.
- `src/components/ui`: shadcn/ui sources, converted to logical (start/end) classes for RTL.
- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before using an API (see `AGENTS.md`).
