# Content packs

Everything a learner studies, written by Claude for every level of both languages (owner, 18 Nov 2026:
DECISIONS.md). The files here are the source; the server loads what is new at start, through the
panel's own importers and checks, and publishes it. After loading, the database is the truth: a
teacher may edit or delete anything, and a later load never brings back or overwrites what they changed.

```
content/
  fr/                     one folder per language (fr, de)
    words/A1.tsv          the word list of a level, in teaching order
    words/A2.tsv …
    names.txt             proper names sentences may use (later)
    sentences/ grammar/ texts/ …   (formats added with the pack builder)
```

## Word lists: `content/<language>/words/<LEVEL>.tsv`

One word per line, **in teaching order** (the first line is taught first). UTF-8, cells separated by a
single tab. A first line starting with `lemma<TAB>` is a header; lines starting with `#` are notes (use
them for section headings such as `# family`); empty lines are skipped.

Seven fixed cells, always present (an empty cell is two tabs side by side):

| # | Cell | What it holds |
| --- | --- | --- |
| 1 | `lemma` | Dictionary form. French nouns without article; German nouns capitalised, without article; verbs in the infinitive; adjectives in the masculine singular. A phrase is written in full (`il y a`, `es gibt`). |
| 2 | `pos` | `noun verb adj adv prep pron det conj num interj phrase` |
| 3 | `gender` | Nouns only. French `m`, `f`, `mf` (both, *un/une élève*); German `der`, `die`, `das`. Empty for other parts of speech. |
| 4 | `plural` | Nouns. German: required for every noun that has a plural (`Tische`). French: only when irregular (`yeux`, `chevaux`), else empty. |
| 5 | `meaning_fa` | Up to three simple Persian equivalents of the **one** sense taught at this level, separated by «، ». Persian letters (ی and ک), half-spaces where Persian needs them. |
| 6 | `concept_fa` | One short Persian concept label. Words that mean the same (*voiture*, *bagnole*) share it exactly; otherwise unique within the language. A label may name the word to tell senses apart («nous: ما»). |
| 7 | `topic` | One of the topics below. Wrong options of fill-the-gap sentences are taken from words of the same topic and part of speech, so choose the topic a learner would file the word under. |

Then any of these optional `key:value` cells, in any order:

| Key | Value |
| --- | --- |
| `code` | Only when two words share a lemma: `livre-m` / `livre-f`, `des-contr`, a second sense `glace-2`. Default: the lemma. |
| `sense_of` | For a second sense: the code of the first (`glace-2` … `sense_of:glace`). It may not be of a higher level. |
| `number` | Nouns: `pl_only` (*les gens*, *die Leute*) or `sg_only` (no plural in use: *die Milch*, *le courage*; the plural cell stays empty). |
| `register` | `familier`, `argot` or `formal` (default `standard`). A colloquial word needs a standard word with the same `concept_fa`. |
| `mastery` | `recognize` for a B1/B2 word a learner only needs to understand; default `produce` (always produce at A1 and A2). |
| `no_card:1` | Function words taught in grammar lessons only (articles, *de*, *et*, *à*, *zu* …). They never get a word card. |
| `family` | A closed set, one target-language word shared by all members: `couleur`, `jour`, `mois`, `Farbe`, `Zahl` … |
| `parts` | Phrases: the codes of the content words that build it, space-separated (`parts:avoir faim`). Each must be in the lists at this level or lower. |
| `homophones` | Common words of this level or lower pronounced exactly the same, comma-separated (`homophones:vert,verre,vers`). |
| `note` | Persian note, only for a false friend or a mistake Persian speakers typically make. |
| `coll` | Up to three common collocations: `coll:en voiture → با ماشین ; prendre la voiture → ماشین برداشتن`. Every word in them must be of this level or lower. |
| `checked` | A checker warning you looked at and the word is right anyway: `checked:gender`, `checked:plural`, `checked:level` (comma-separated). |

Examples (tabs shown as `⇥`):

```
lemma⇥pos⇥gender⇥plural⇥meaning_fa⇥concept_fa⇥topic
# family
mère⇥noun⇥f⇥⇥مادر⇥مادر⇥family⇥family:famille
œil⇥noun⇥m⇥yeux⇥چشم⇥چشم⇥body
manger⇥verb⇥⇥⇥خوردن⇥خوردن⇥food⇥coll:manger au restaurant → در رستوران غذا خوردن
avoir faim⇥phrase⇥⇥⇥گرسنه بودن⇥گرسنگی⇥food⇥parts:avoir faim
le⇥det⇥⇥⇥حرف تعریف معین (مذکر)⇥حرف تعریف معین⇥function⇥no_card:1
Milch⇥noun⇥die⇥⇥شیر (نوشیدنی)⇥شیر⇥drink⇥number:sg_only
```

### Topics

`function people family body health food drink home city transport travel shopping clothes work
education time numbers colors weather nature animals leisure media feelings character actions qualities
space abstract society economy science culture` (definitions in `src/server/content/packs/words.ts`).

### Levels and order (how the lists are built)

- **Level** combines three signals: the frequency rank (`data/frequency`; vocabulary-size studies put A1
  inside the first 1,000–1,500 words and A2 inside 2,500: Milton 2010), the CEFR themes and can-do
  statements of the level (Council of Europe 2001, 2020), and need: a word the level's grammar lessons,
  texts and dialogues cannot do without belongs there. The checker warns when a word is far rarer than its
  level or too common for B1 and above; mark `checked:level` only with a reason.
- **No word twice**: a word is taught at its lowest level; a later level may add a *new sense* (`code`,
  `sense_of`).
- **Teaching order** inside a level: the words needed to make sentences come first (pronouns, *être/sein*,
  *avoir/haben*, articles as `no_card`, the commonest verbs and nouns), then topic by topic, frequent words
  before rare ones. Sentences for a word may use only words taught before it (and `no_card` words), so a
  word that early sentences need must come early.
- **Meanings** are the sense used at this level, checked against a dictionary; gender and plural are checked
  against the open lexicons in `data/lexicon` (every disagreement is a warning to resolve).

### Checking

```
npm run content:words -- fr            # or de; both when left out
npm run content:words -- de --warnings --missing=300
```

It runs every rule of the panel's word import, reports errors (the loader refuses a pack with any) and
warnings, the size of each level against its target (`targets.<language>` in the general settings),
parts of speech, topics, frequency ranks, the coverage of the most frequent words, and the most frequent
lemmas the lists leave out (for German the frequency list holds word forms, so inflected forms show up
there too).
