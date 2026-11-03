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
| `npm run test:e2e` | Playwright on phone and desktop sizes; needs `npm run build` first. Starts its own server on the test database (`E2E_DATABASE_URL`, else `TEST_DATABASE_URL`), wiped and seeded each run, and a second server for `learner.spec.ts` on `<that database>_learner` with the French demo. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium |
| `npm run db:migrate` | New versioned migration from `prisma/schema.prisma` (development only) |
| `npm run db:deploy` | Apply migrations on a server |
| `npm run seed` | Languages, engine and general settings, one admin and one tester (`SEED_ADMIN_PHONE`, `SEED_TESTER_PHONE`) |
| `npm run make-admin -- 09121234567 fr` | Make a phone an admin (first admin; later ones from the panel) |
| `npm run demo -- load` | French demo content for the tester account (`remove` takes it and testers' progress on it out, `status`) |
| `npm run simulate` | PRD §16.3 simulator: synthetic learners through the real engine, checked against the pass marks (`-- --quick` for a fast look, `--seed=x`). Long random test: `RANDOM_USERS=400 RANDOM_DAYS=30 npx vitest run tests/unit/engine/random.test.ts` |

Deploy: Runflare builds `main` (`docs/deploy-runflare.md`). Work on the session branch and move `main` forward
(fast-forward) only when unit, database and browser tests are all green.

## Code map
- `prisma/schema.prisma`: PRD §4. Models are PascalCase, tables and columns keep the PRD names.
- `src/engine`: pure functions (PRD §15.3). `src/server`: database, auth, SMS, storage, settings.
- Engine checks (PRD §16.3): `src/engine/invariants.ts` (`checkInvariants`, the rules that never break). Synthetic content
  and learners in `fixtures/synthetic` (`index.ts` content, `drive.ts` plays a session, `human.ts` the simulator's learner,
  `learner.ts` state helpers); `tests/unit/engine/random.test.ts` the random test; `scripts/simulate.ts` the simulator.
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
- «بازبینی» (PRD §13.4, §13.9 step 4; approving happens only here): `src/server/content/review` — `queue.ts` sends a batch
  to review after QA (the B1+ sentence sample), `decide.ts` approve, reject and what blocks approval, `list.ts` the queue,
  `preview.ts` the learner's screens built with the engine's own builders (dialogues, find the mistake and writing also at the
  bottom of their item page, any status), `findings.ts` the «مشکوک» marks. Page
  `src/app/admin/review`, phone frame `src/components/admin/review/learner-preview.tsx`.
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
- «راهنمای پنل»: `src/app/admin/guide` (texts in `admin.guide` of fa.json, written in the small markup of
  `src/lib/guide-markup.ts`; `links.ts` maps `{{page}}` names to panel pages). Public «درباره»: `src/app/about`.
- «خروجی و ورود فایل» (`src/app/admin/transfer`, downloads from `file/route.ts`): `src/lib/csv.ts` reads and writes
  CSV; `src/server/content/transfer/export.ts` turns every list into CSV or JSON; `words-csv.ts` is the PRD §14.7
  word file import (check first, then import; `csvOrder` sets the lesson order from the file).
- «کاربران» (`src/app/admin/users`): `src/server/accounts.ts` searches by phone, lists teachers and testers, sets
  `is_admin`/`is_tester` and adds accounts; its log rows (entity `user`) show in the change log under «کاربران».
- Sentence listening (PRD §7.6): `src/engine/drill.ts` (suitable sentences, L1–L3, the gate and the home counts),
  `src/engine/dictation.ts` (word-by-word dictation scoring for L3 and later Q-dict); plan items `l:<sentence id>`,
  written to `sentence_drill_state` by `answer.ts`.
- Texts (PRD §7.3–7.5, §7.9, §10.11): `src/engine/texts.ts` (attempts and their stages, the next text, cost, track score,
  level, `afterStage`), `src/engine/questions.ts` (grading the nine question kinds). Server: `answer.ts` writes `text_state`
  and a `review_log` row per question; `src/server/learn/text-progress.ts` keeps a stage left half-way (route
  `api/learn/text-progress`). Browser: `src/components/learn/session/text.tsx` (one stage on one screen, the review
  page), `text-questions.tsx` (each kind's control and review), `text-body.tsx` (the sentences), `text-sound.ts` (plays,
  pause, slow, sentence by sentence), `text-reader.tsx` («متن‌های من», pages `learn/[lang]/texts`). Demo texts:
  `fixtures/demo-fr/texts.ts` (new ones are added to a loaded demo on the next load). Without sound (PRD §10.12):
  `needsSound`/`onlySoundLeft` in `src/engine/session/play.ts`; the player drops such cards with `{skip:"drop"}` or asks
  for a silent session (`replace: true` on `/api/learn/session`). «آزمایش مثل زبان‌آموز»'s texts: `textsOverview` in `rehearse.ts`.
- Phonics (PRD §8): `src/engine/phonics.ts` (the next round, each kind's questions P1–P5 as the panel's switches allow,
  the lesson after a round, «بعداً»); plan key `p:<lesson id>`, a lead card `phonics` and its `phonicsq` questions in one
  block (`{skip:"drop"}` takes the rest out unscored without sound). Server: `answer.ts` writes `phonics_state`,
  `lists.ts` `myPhonics`/`myPhonicsLesson`. Pages `learn/[lang]/phonics` and `phonics/[id]`; the P2–P5 controls are in
  `exercise.tsx`, the lesson face `PhonicsFace` in `cards.tsx`. Demo lessons: `fixtures/demo-fr/phonics.ts`.
- Speaking and writing (PRD §8b): `src/engine/production.ts` («بگو، بعد بشنو» S1 order and gaps, dialogues S3, find the
  mistake S4 and its grading, the weekly writing card). Plan keys `s:`/`d:`/`e:`, cards `speak`/`dialogue`/`errorfix` with
  `card.prod` (step 6 and 8 of `build.ts`; production yields when due reviews did not fit). Server: `answer.ts` writes
  `speak_state`/`dialogue_state`/`errorfix_state`; `src/server/learn/writing.ts` the writing card, page, save (week, streak) and
  «نوشته‌های من» (route `api/learn/writing`). Browser: `src/components/learn/session/speaking.tsx` (the three screens, also in
  the panel's preview), `src/components/learn/writing.tsx`, pages `learn/[lang]/writing` (`?task=` for a tester's try, not kept)
  and `writings`. Demo: `fixtures/demo-fr/speaking.ts`. «آزمایش مثل زبان‌آموز»: `productionOverview` in `rehearse.ts`.
- Placement (PRD §11): `src/engine/placement.ts` (the blocks, grammar, texts, «ادامه نمی‌دهم», the result, `placementOutcome`,
  the sample after it with `applySampleAnswer`, `typoForms`, and `placementReadiness` for the panel). The sample's words are
  probation `sample` cards (W5a with `typo`); its grammar sentences are plan key `g:<target id>` (G5b, `review_log.kind =
  placement`, no card). Server: `src/server/learn/placement.ts` (the run in `placement_run`, graded on the server,
  `recordSample` from `answer.ts`, `takeSampleNotice` from `finish.ts`). Pages `learn/[lang]/placement` and the paused home
  (`placement/paused.tsx`). «آزمایش مثل زبان‌آموز»: `placementOverview`/`rehearsePlacement` in `rehearse.ts`, card `admin/try/placement.tsx`.
- Level tools (PRD §11.5–§11.7, §3.13): `src/engine/pretest.ts` (the pretest mode from the new-word timeline; «این را بلدم» is
  `{iknow:true}` on an intro or lesson card with `probationStep`, checked in `answer.ts`), `src/engine/exam.ts` (the skip exam:
  offer, items, early end, result; state in `level_exam.state`), `src/server/learn/exam.ts` and pages `learn/[lang]/exam/[skill]`,
  `src/engine/leveldown.ts` (the lower-level offer; «بله» in `src/server/learn/leveldown.ts`), `src/engine/path.ts` (end of the
  path, shown once by `finish.ts`). End messages are picked in `finish.ts` by `src/engine/messages.ts`.
- Sales (PRD §12): `src/server/billing` — `gateway.ts` (`PAYMENT_GATEWAY`: the test bank `mock`, `zarinpal`), `subscriptions.ts`
  (`extendAccess` with the validity rule, `shortenAccess`, `unlockedModules`), `discounts.ts` (`checkCode`), `orders.ts` (`quote`,
  `startOrder`, `returnFromGateway`, `followUpOrder`, `sweepOrders`), `admin.ts` (plans, codes, orders, grants; log entity `sales`),
  `learner.ts`. Free period and lock: `src/server/learn/access.ts`, `home.ts` (`lockSummary`). Pages: learner `learn/[lang]/plans`
  (lock page, `plan-picker.tsx`) and `subscription` («اشتراک من»), `/pay/return` (verify), `/pay/mock` (test bank), cron
  `/api/cron/orders` (`CRON_SECRET`); panel `/admin/sales`, `/admin/orders`, and the «اشتراک و خریدها» section of `/admin/users/[id]`
  (`subscription-tools.tsx`). Separate modules filter content in `learnerContent` (`moduleFilter`).
- Insights (PRD §13.2, §13.11): `src/server/insights/learning.ts` («یادگیری واقعی»: step × interval, first review, codes,
  learners, production, funnel; page `src/app/admin/learning`), `dashboard.ts` (page `src/app/admin/dashboard`),
  `src/server/content/health/suspects.ts` (items learners fail, texts out of place, on «سلامت محتوا»). Testers and teachers
  are left out unless `testers=1`.
- Install (PRD §3.11 row 7, §15.6): `src/app/manifest.ts`, `public/icons` (placeholders), the service worker `src/app/sw.js/route.ts`
  (static files and session sound, range answers for Safari), `src/components/learn/install.ts` (install state sent as `device`
  with each answer, Chrome's window, `keepSessionSound`); the offer is picked in `finish.ts` and drawn by `InstallNote` in `end.tsx`.
- Account (PRD §15.5): `src/server/learn/account.ts` (`phoneFree`, `changePhone` for the app and «کاربران», `deleteAccount`,
  `deletionNotes`); app actions `src/app/(learner)/account-actions.ts` (the code goes to the new number, purpose `change_phone`),
  pages `learn/[lang]/{phone,delete,support}` and the public `/terms`; the panel form is `admin/users/[id]/phone-change.tsx`.
  A teacher's text from «تنظیمات عمومی» is drawn by `src/components/plain-text.tsx`.
- «گزارش اشکال» (PRD §13.10, T72): `src/engine/report.ts` («حق با تو بود»: the notebook entry, step and `fail_count`).
  `src/server/reports`: `file.ts` (`fileReport` from the feedback sheet, by the answer's `review_log` id; `takeReportNotices`),
  `admin.ts` (accept the answer, fixed, suspend, reject, priority), `list.ts` (queue, one report, open counts), `preview.ts` (the
  exercise rebuilt for the panel), `slugs.ts`. Browser: `src/components/learn/session/report.tsx` (the sheet), route `api/learn/report`,
  home notice bar in `home.tsx`. Panel: `src/app/admin/reports` (list, `[id]` page, `report-actions.tsx`).
- Learner sessions (PRD §10, §15.4): `src/engine/session` builds and plays a plan (`build.ts`, `play.ts`, `advance.ts`);
  the browser and the server run the same functions. `src/server/learn`: `content.ts` (what a learner or tester may
  see, cached 30s), `learner.ts` (the snapshot the engine needs), `session.ts` (start, resume, close, preview),
  `answer.ts` (one answer: checked, graded again, written), `finish.ts` (end screen, with the one PRD §3.11 message picked by
  `src/engine/messages.ts`), `home.ts`, `enroll.ts`. Routes:
  `src/app/api/learn/*` (`tap` queues a touched word, PRD §5.9, via `tap.ts`). `lists.ts` feeds the reading pages.
  Demo content: `fixtures/demo-fr` (data and `build.ts`), loaded by `src/server/content/demo.ts`.
- Learner app (`src/app/(learner)`, styles in `learner.css` under `.lx`): `/start` and `/start/[lang]` (onboarding),
  `/learn/[lang]` (home: `home.tsx` with the WebGL jelly `src/components/learn/jelly.tsx`, skill tiles and sheets),
  `/learn/[lang]/session` (`src/components/learn/session/player.tsx`: the browser runs `playCard`, answers go through
  `outbox.ts`, a localStorage queue that survives a lost connection; `exercise.tsx` draws every answer kind,
  `cards.tsx` the word card, lesson and tables, `feedback.tsx`, `end.tsx`, `keyboard.tsx` the in-app keyboard),
  and the reading pages `notebook`, `words`, `words/[id]`, `lessons`, `lessons/[id]`, `texts`, `texts/[id]`, `phonics`, `phonics/[id]`. Sounds, haptics and motion:
  `src/components/learn/{sfx,motion,speak}.ts`; Latin words inside Persian text: `mixed.tsx`.
- `src/i18n/fa.json`: every Persian interface string; `t("key", vars)` from `@/i18n`.
- `src/components/ui`: shadcn/ui sources, converted to logical (start/end) classes for RTL.
- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before using an API (see `AGENTS.md`).
