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
To be filled in when the project skeleton exists (PRD §15.9 lists the planned ones).
