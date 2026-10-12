# Product

<!-- impeccable:product-schema 1 -->

Sources: `docs/PRD.md` (the owner's own product document, v2.4) and the owner's messages in the
project thread. Each fact below comes from one of them; nothing is inferred unless marked.

## Platform

web

## Stack

Next.js (App Router), TypeScript, Prisma/PostgreSQL, Tailwind with shadcn/ui, PWA (PRD §15).

## Users

Persian-speaking adults in Iran learning French or German from zero (A1) to B2. They open the app
on a phone for a short daily session (default 15 minutes) and press one button. Many are not
technical. (PRD §1, §3)

## Product Purpose

One "Start" button: the engine decides what to learn today, which exercise, and how hard. There is
no chapter or lesson menu. Success is reaching B2 in understanding (vocabulary, grammar, reading,
listening) plus a solid base in speaking and writing, with an honest estimate of how long it takes.
(PRD §1)

## Positioning

An engine that mixes four skills and spaced repetition (FSRS) into one daily session, with
controlled vocabulary (sentences use words the learner already knows) and real zero-start: every
new item is introduced before it is tested, and the first attempt is never penalized. (PRD §1)

## Operating Context

- Daily session on a phone, often in short gaps; a "short on time today" mode exists.
- Audio everywhere: every word and sentence has sound, played automatically after each answer.
- An in-app Latin keyboard for typing French and German; the phone keyboard never opens.
- French and German are two fully separate products inside one app (progress, plan, streak).
- Admin and teachers fill content through a separate admin panel (PRD §13).

## Capabilities and Constraints

- Interface language: Persian first; the interface must be switchable to other languages, English
  next (owner decision, `DECISIONS.md`). RTL and LTR both supported.
- v1 is for users inside Iran only: SMS login, Iranian payment gateway, Iranian hosting.
- No AI inside the app; no runtime dependency on services outside Iran (fonts self-hosted).
- Out of v1: leagues and XP, offline mode, video, C1. (PRD §1)

## Brand Commitments

- Name: Polyra (پلریا).
- No emoji anywhere. (PRD §2)
- No gamification devices such as leagues or XP. (PRD §1)
- Owner's words on the feel: refined, chic, modern, "scientific and business-like"; colors that do
  not tire the eye over time; not childish. Matte, glass, and moving-liquid materials are welcome,
  with liquid only on the Start card (owner decision). Dark mode must stay as attractive as light.
  Sound matters. Each skill should have a meaningful, weighty icon, not an arbitrary shape.

## Evidence on Hand

- Real content examples exist only inside the PRD (sample words, sentences). No logo, no
  illustrations, no photography, no testimonials yet. Do not invent user numbers or results.

## Product Principles

1. Fewest choices: the learner presses Start; the engine decides.
2. Honesty: an "I don't know" button on every exercise; no penalty on the first try; real time
   estimates.
3. Calm seriousness: an adult learning tool, not a game.
4. Sound and the target language are the heroes of every screen.

## Accessibility & Inclusion

Large touch targets, reduced-motion support, both themes, Persian digits in Persian UI.
