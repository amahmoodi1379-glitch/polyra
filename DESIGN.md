---
name: Polyra
description: A Persian app for learning French and German, where one living raspberry jelly starts the day's session and everything around it stays calm.
colors:
  raspberry: "#D81E5B"
  raspberry-deep: "#A8134A"
  raspberry-light: "#F0527F"
  blush: "#FDE7EF"
  aubergine: "#2B1020"
  teal: "#1FB5A8"
  blush-ground: "#FFF6F9"
  surface: "#FFFFFF"
  blush-deep: "#F9D5E2"
  hairline: "#F0DDE5"
  hairline-strong: "#E2C4D1"
  ink-soft: "#5E3F50"
  ink-faint: "#7A5A6C"
  raspberry-text: "#C21852"
  teal-text: "#0E8077"
  teal-wash: "#DDF5F2"
  raspberry-wash: "#FBE0EA"
  gender-feminine: "#8E3BB0"
  gender-masculine: "#2962C4"
  gender-neuter: "#A66C0C"
  night-surface: "#381A2B"
  night-tint: "#45213A"
  night-ink: "#FDE7EF"
  night-ink-soft: "#DCC0CD"
  night-ink-faint: "#B994A8"
  night-raspberry-text: "#F27AA0"
  night-teal-text: "#3FD3C5"
  night-gender-feminine: "#D9A2EE"
  night-gender-masculine: "#9DBBF5"
  night-gender-neuter: "#E9B75E"
typography:
  wordmark:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "60px"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontVariation: "'SOFT' 100, 'WONK' 1, 'opsz' 144"
  headword:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "92px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontVariation: "'SOFT' 100, 'WONK' 1, 'opsz' 144"
  display:
    fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1.25
  headline:
    fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.4
  title:
    fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.3
  target-sentence:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.5
    fontVariation: "'SOFT' 100, 'opsz' 48"
  target-text:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.4
    fontVariation: "'SOFT' 100, 'opsz' 36"
  body:
    fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
    lineHeight: 1.3
  level:
    fontFamily: "Fraunces, Georgia, 'Times New Roman', serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1
    fontVariation: "'SOFT' 100"
rounded:
  chip: "10px"
  control: "14px"
  field: "16px"
  button: "20px"
  card: "22px"
  panel: "24px"
  sheet: "28px"
  round: "50%"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  gutter: "20px"
  xl: "24px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.raspberry}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "58px"
    padding: "0 24px"
  button-primary-active:
    backgroundColor: "{colors.raspberry-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
  button-secondary:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.raspberry-text}"
    rounded: "{rounded.button}"
    height: "54px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    height: "44px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    size: "44px"
  chip-level:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.raspberry-text}"
    typography: "{typography.level}"
    rounded: "{rounded.chip}"
    height: "28px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.aubergine}"
    rounded: "{rounded.card}"
    padding: "14px 18px"
  answer-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.aubergine}"
    typography: "{typography.target-text}"
    rounded: "{rounded.button}"
    height: "76px"
  answer-option-correct:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal-text}"
    rounded: "{rounded.button}"
  answer-option-wrong:
    backgroundColor: "{colors.raspberry-wash}"
    textColor: "{colors.raspberry-deep}"
    rounded: "{rounded.button}"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.aubergine}"
    rounded: "{rounded.sheet}"
    padding: "12px 20px 22px"
  segmented:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.field}"
    padding: "4px"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.raspberry-text}"
    rounded: "12px"
    height: "42px"
---

# Design System: Polyra

## Overview

**Creative North Star: "The Jelly on the Desk"**

A calm, well-lit study desk with one irresistible object on it: a glossy raspberry jelly with the word
"polyra" on it. The jelly is alive. It breathes, shifts shape, squashes under the finger and starts
the day's session. Everything else on the desk is tidy and quiet: soft blush paper, white cards,
aubergine ink, generous corners. The fun lives in one place so the rest of the app can stay serious
about learning without ever feeling childish.

The audience is Persian-speaking adults who study in short daily gaps on a phone. The interface is
right-to-left Persian by default and must flip cleanly to left-to-right for other interface languages.
French and German text is always set in a soft serif so the language being learned looks like a
beautiful book, not a game. Density is low on the learner's daily loop: one decision per screen, big
targets, the answer area at the thumb.

The owner rejected three earlier worlds: flat geometry (childish), the engraved certificate and
Tehran modernism. The owner then fixed the palette to six colors and asked for the jelly Start button.
Treat both as permanent.

**Key Characteristics:**
- Six brand colors only; every other value is a tint, shade or wash of one of them.
- One living material (the jelly). It appears on Start and, small and still, on the station drop.
- Persian in Vazirmatn, the target language in Fraunces with its SOFT axis turned up.
- Day and night designed separately; night is aubergine, not grey.
- Soft, tinted shadows and generous radii (20 to 28px); no hard edges, no hard offset shadows.
- Sound, light haptics and spring motion on every touch, all switchable, all reduced-motion aware.

## Colors

A raspberry family on blush paper with aubergine ink and one cool counterpoint, teal, that only ever
means "right" or "safe".

### Primary
- **Raspberry** (#D81E5B): the action color. Primary buttons, the jelly's body, progress fills, the
  streak icon, switches that are on. Text on raspberry is white (4.9:1).
- **Deep Raspberry** (#A8134A): the pressed state of raspberry, the jelly's rim, and the color of a
  wrong answer (owner's choice). Never used for decoration.
- **Light Raspberry** (#F0527F): highlights inside glossy objects (jelly, play button, button top
  edge), focus rings, and the start of progress gradients. Too light for text on day ground.
- **Raspberry Text** (#C21852): raspberry darkened for small text on blush ground (4.7:1). By night
  it becomes **Night Raspberry Text** (#F27AA0).

### Secondary
- **Teal** (#1FB5A8): correct answers (ring, tick, feedback mark), the streak-freeze icon, and the
  cool streak inside the jelly's rim. As text it darkens to **Teal Text** (#0E8077) by day and
  lightens to **Night Teal Text** (#3FD3C5) by night. **Teal Wash** (#DDF5F2) fills a correct option.

### Neutral
- **Blush Ground** (#FFF6F9): the day page. Deliberately lighter than blush so a full screen of it
  does not tire the eye (owner approved).
- **Blush** (#FDE7EF): tinted surfaces: chips, secondary buttons, segmented tracks, the station panel,
  progress tracks, hover and pressed backgrounds. **Blush Deep** (#F9D5E2) is its pressed step.
- **Surface** (#FFFFFF): cards, sheets and answer options by day.
- **Aubergine** (#2B1020): ink by day and the ground by night. **Ink Soft** (#5E3F50) for secondary
  text, **Ink Faint** (#7A5A6C) for hints and meta text (5.6:1 on blush ground).
- **Hairline** (#F0DDE5) and **Hairline Strong** (#E2C4D1): dividers inside cards and dashed rules.
- Night: ground Aubergine (#2B1020), surface **Night Surface** (#381A2B), tint **Night Tint**
  (#45213A), ink **Night Ink** (#FDE7EF), soft ink #DCC0CD, faint ink #B994A8.

### Gender colors
Fixed per gender wherever a noun appears (PRD §5), always beside the written article, never alone:
feminine plum (#8E3BB0), masculine blue (#2962C4), neuter ochre (#A66C0C, German only). Night uses
#D9A2EE, #9DBBF5 and #E9B75E. None of them is raspberry or teal, so a gender is never read as
"wrong" or "right".

### Named Rules
**The Six Colors Rule.** The owner's six colors (#D81E5B, #A8134A, #F0527F, #FDE7EF, #2B1020,
#1FB5A8) are the whole brand. New values are only tints, shades or washes of these, plus the three
gender colors.

**The Teal Means Right Rule.** Teal appears only for correct answers and protection (the streak
freeze). Never as decoration, never as a link color.

**The Wrong Is Not Red Rule.** A wrong answer is deep raspberry (#A8134A) with a wash, never a pure
red and never shaking the whole screen. Mistakes are part of learning (PRD: the first attempt is never
penalized).

## Typography

**Persian Font:** Vazirmatn (with Tahoma, Segoe UI, sans-serif)
**Target-language Font:** Fraunces (with Georgia, Times New Roman, serif)

**Character:** Vazirmatn is clear and friendly at every weight, carrying all Persian interface text.
Fraunces with SOFT 100 has rounded, slightly wonky terminals that match the jelly, and it sets French
and German like a good dictionary. Both are OFL and self-hosted in the app (rule 9).

### Hierarchy
- **Wordmark** (Fraunces 640, 60px, SOFT 100, WONK 1, opsz 144): "polyra", lowercase, on the jelly
  only. Its fill is a slow-moving gradient of white, blush, mint and pink (owner's request).
- **Headword** (Fraunces 600, 92px, line-height 1.05): the word being introduced. The article sits
  before it at 0.36em, italic, in the gender color.
- **Display** (Vazirmatn 800, 36px, 1.25): screen titles such as «جلسه تمام شد».
- **Headline** (Vazirmatn 800, 30px, 1.4): the Persian meaning under a headword; feedback titles at 26px.
- **Title** (Vazirmatn 800, 24px, 1.3): sheet titles.
- **Target sentence** (Fraunces 400, 32px, 1.5): exercise sentences. Examples at 24px, collocations
  at 19px, answer options at 24px weight 500.
- **Body** (Vazirmatn 400, 15px, 1.65): running text, list rows (14.5px), translations (14px).
- **Label** (Vazirmatn 700, 12.5 to 13.5px): field labels, card headings, hints.
- **Level** (Fraunces 600, 18px; 26px in the skill sheet; 15px in the top-bar chip): CEFR levels
  such as A2 are Latin and always in Fraunces.

### Named Rules
**The Two Voices Rule.** Persian is always Vazirmatn, the language being learned is always Fraunces.
Latin text is isolated (`direction: ltr; unicode-bidi: isolate`) so it never scrambles inside a
Persian line.

**The No Uppercase Rule.** No uppercase eyebrows, no letter-spaced kicker labels above headings.

## Layout

Phone first. The learner column is at most 440px wide and centered, with a 20px side gutter. Screens
are a single vertical stack with an 18px gap. On desktop the same column sits centered on the ground;
nothing stretches to fill a wide screen.

- **Top bar and session bar** are sticky, sit on a blurred ground at 84%, and every control in them
  is a 44px target.
- **Action area at the thumb.** Primary and secondary actions live in a sticky bottom block (12px top
  padding, 14px plus safe area at the bottom) on blurred ground. The screen content above it scrolls.
- **Home** order (PRD §3.2): top bar, subscription line, the jelly hero (330px tall) with its
  subtitle, the short-session link, four skill cards in one row of four, then the links card.
- **Session end** order follows PRD §3.9 exactly.
- Minimum touch target is 44px everywhere; answer options are 76px tall in a two-column grid with a
  10px gap.
- Digits that line up use tabular figures. Persian digits are used in Persian text.

## Elevation & Depth

A soft, lifted system. Surfaces are white cards floating a little above blush paper, with shadows
tinted toward aubergine rather than grey. Glossy objects (the jelly, the play button, primary
buttons) get an inner top highlight and a raspberry glow; flat containers never do.

### Shadow Vocabulary
- **Card lift** (`0 1px 2px rgba(43,16,32,.05), 0 10px 26px -14px rgba(120,20,60,.28)`): cards,
  skill cards, answer options, score tiles. Night: `0 1px 2px rgba(0,0,0,.3), 0 12px 28px -14px rgba(0,0,0,.6)`.
- **Sheet rise** (`0 -1px 0 rgba(43,16,32,.04), 0 -18px 44px -22px rgba(120,20,60,.4)`): bottom
  sheets and the feedback sheet.
- **Raspberry glow** (`0 10px 22px -10px rgba(216,30,91,.6)`): primary buttons and the play button
  only, together with `inset 0 1px 0 rgba(255,255,255,.38)`.

### Named Rules
**The One Living Thing Rule.** Only the jelly moves on its own. Everything else moves only in
response to a touch or a state change.

**The Glass Is Furniture Rule.** Blur is used only for bars that content scrolls under (top bar,
session bar, bottom action block). No decorative glass cards.

## Shapes

Round and soft, like the jelly. Chips 10px, small controls 14px, fields and segmented tracks 16px,
buttons and answer options 20px, cards 22px, the station panel 24px, sheets 28px on their top corners.
Circles for the play button, the mini play button, monograms and feedback marks. Progress bars are
rounded tracks (radius half their height) with a light-raspberry to raspberry fill.

Skill icons are custom duotone drawings on a 24-unit grid: a soft blush body with a fine raspberry
outline plus one solid raspberry part. Vocabulary is stacked word cards with an "A", grammar a
sentence tree, listening headphones, reading an open book. Line icons elsewhere are 1.6px strokes
with round caps.

## Components

### The Jelly (Start)
- **What:** the Start button. A WebGL raspberry jelly (signed-distance blob with two orbiting lobes,
  height-field normals, specular highlights, a teal-and-pink rim) with the wordmark on top. No
  «شروع» label (owner decision); the PRD subtitle «۱۵ دقیقه · ۱۸ مرور و ۶ مطلب جدید» stays under it,
  plus a first-time hint «ژله را لمس کن تا جلسه شروع شود» until the first start.
- **Touch:** squashes toward the finger on press (spring k 260, damping 13), bulges toward the
  pointer, ripples from the touch point, plays a soft press sound and a 10ms buzz. On release it
  swells (lift spring k 200, damping 14, target 1.18 at 140ms) and the session opens at 480ms.
- **Fallback:** without WebGL a CSS blob with a morphing border-radius. With reduced motion the jelly
  is drawn once, still, with a one-line note.
- **Scope:** home only. Pauses drawing when home is hidden.

### Buttons
- **Shape:** generously rounded (20px), 58px tall for primary.
- **Primary:** raspberry with a vertical gradient from light raspberry to deep raspberry, white
  800-weight text, raspberry glow, inner top highlight. Pressed: a jelly squash (520ms: wide and
  short, then tall and narrow, then settled).
- **Secondary:** blush fill, raspberry-text label, 54px tall, 18 to 20px radius.
- **Ghost:** text only in ink soft, 44px tall, under the primary in the bottom block.
- **Icon button:** 44px square, 14px radius, ink soft; blush background on hover and press;
  `aria-pressed` turns it raspberry-text on blush.
- **Focus:** a 2px light-raspberry outline with 3px offset on every focusable element.

### Chips
- **Level chip:** blush with raspberry-text Fraunces, 28px tall, 10px radius. Calm, not glossy.
- **Count badge:** blush pill, raspberry-text, 800 weight.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** surface (white by day, #381A2B by night).
- **Shadow Strategy:** card lift (see Elevation).
- **Border:** none; rows inside a card are divided by a 1px hairline.
- **Internal Padding:** 14 to 18px; list cards use 16px side padding and 54 to 56px rows.
- **Tinted panel:** the station panel is blush, 24px radius, no shadow.

### Answer options
- **Default:** surface, 1px hairline inset ring, card lift, Fraunces 24px.
- **Correct:** teal wash, teal-text label, 2px teal inset ring, and a teal tick that pops in with an
  overshoot spring.
- **Wrong:** raspberry wash, deep raspberry label and 2px ring.
- **Others after answering:** 40% opacity.

### Feedback sheet
Slides up from the bottom with a spring (0.45s, bounce 0.22). Its background is the tone's wash mixed
70% into the surface; a filled 38px circle mark (teal, deep raspberry, or ink faint for "I don't
know") pops in beside a 26px 800-weight title in the tone's text color. Then the correct answer, the
word with its article in the gender color, the translation, the primary «ادامه» and a quiet report
link.

### Inputs and settings
- **Segmented control:** blush track (16px radius, 4px padding); the selected option is a white chip
  with raspberry-text label and a small tinted shadow.
- **Switch:** 52 by 32px, hairline-strong track that turns raspberry when on; white knob that moves
  with an overshoot spring. In RTL the "on" knob sits on the left.
- **Text fields** (not yet designed): follow the segmented track: blush fill, 16px radius, a
  light-raspberry focus ring.

### Navigation
The learner app has no tab bar. Home is the hub; the session has a sticky session bar (close,
progress track, sound toggle). Sheets (settings, skill details) rise from the bottom over an
aubergine scrim and close with Escape, the scrim, or a button.

### Station drop
At session end a raspberry teardrop with the station number falls in, squashes and settles
(900ms keyframes), then a soft "ready" sound plays.

## Do's and Don'ts

### Do:
- **Do** keep every color inside the six brand colors, their tints and washes, plus the three gender colors.
- **Do** use teal only for "right" and the streak freeze, and deep raspberry (#A8134A) for "wrong".
- **Do** set the language being learned in Fraunces SOFT and isolate it as left-to-right text.
- **Do** design night separately: aubergine ground (#2B1020), #381A2B surfaces, lighter text tints.
- **Do** give every touch a response: a short squash or spring, a soft sound and a light buzz, each
  switchable in settings and silent under reduced motion.
- **Do** keep touch targets at 44px or more, and the main action in the bottom block at the thumb.
- **Do** self-host Vazirmatn and Fraunces in the app; prototypes may use Google Fonts only as previews.

### Don't:
- **Don't** add a second living or self-moving element next to the jelly; the rest of the screen stays calm.
- **Don't** write «شروع» on the jelly or replace it with a regular button.
- **Don't** use emoji, mascots, confetti, XP, leagues or badges (PRD §1, §2).
- **Don't** return to the rejected worlds: flat geometric skill shapes, engraved certificate paper,
  Tehran modernism, or a cool grey and cobalt "business" palette.
- **Don't** use gradient text anywhere except the jelly wordmark.
- **Don't** use uppercase eyebrows, hard offset shadows, or decorative glass cards.
- **Don't** show a gender color without its written article.
