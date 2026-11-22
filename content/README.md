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
    names.txt             proper names sentences may use, one per line (Marie, Paris)
    grammar/A1/01-etre.txt …   one grammar unit per file, in teaching order by file name
    sentences/A1/*.txt    the fill-the-gap sentences of the level's words
```

Conjugation tables are not written: the loader builds them from the open data (Lefff for French,
Morphy for German) for every verb and every tense of `conjugation.tenses.<language>`.

`npm run content:check` builds everything the way the server does and lists every error with its file and
line; a content PR needs it clean. `npm run content:load` loads it into a local database through the
panel's importers (what the server does at start; CONTENT_PACKS=off on the server turns that off).

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

It runs every rule of the panel's word import, reports errors (a word with an error is not loaded) and
warnings, the size of each level against its target (`targets.<language>` in the general settings),
parts of speech, topics, frequency ranks, the coverage of the most frequent words, and the most frequent
lemmas the lists leave out (for German the frequency list holds word forms, so inflected forms show up
there too).

## Sentences: `content/<language>/sentences/<LEVEL>/*.txt`

The fill-the-gap sentences of the level's words (PRD §5.5, §14.4). Write only the sentence, its gap and the
Persian translation; the builder finds the word of every token (with the open lexicons and Morphy), writes
the Persian meanings from the word lists, and makes three wrong options.

```
// a comment
# voiture
La [voiture] est petite. | ماشین کوچک است.
J'ai une [voiture]. | من یک ماشین دارم.
Il lave sa [voiture] le samedi. | او شنبه‌ها ماشینش را می‌شوید. | d: maison, table, chaise | ok: auto
# manger
Je [mange] une pomme. | من یک سیب می‌خورم.
```

- `# code` starts a word's block (the word's code: its lemma unless the list gives `code:`). Each line is one
  sentence with exactly one `[gap]` holding a form of that word, a bar, the Persian translation, and optional
  cells: `d: a, b, c` three wrong options (else made automatically), `ok: x, y` other right answers,
  `tts: …` the text the machine voice reads instead.
- **Known words only (the usable-sentence rule, PRD §13.11).** Every other word must be taught before the
  block's word: a lower level, earlier in the list, or a function word with `no_card`. The first 30 card
  words of a language count as known among themselves. The checker names any word that comes too late.
- **Wrong options.** For a conjugated verb: other forms of the same verb, with the infinitive as hint. For
  anything else: other words of the same part of speech and topic in the same form (gender and number of a
  noun, agreement of an adjective), never a synonym, a homophone, a word already in the sentence, or a form
  the word before rules out (`l'` + consonant). When the checker says it cannot find three, write `d:`.
- **Reading the words.** A form that could be two words is read from its neighbours (French «la» before a
  verb is the pronoun; German capitals are nouns). When the reading is still wrong, name the word:
  `Il [ferme]{fermer} la porte.` or `word{code}` anywhere in the sentence. A separable German verb is found
  whole (`Ich [stehe] um sieben Uhr auf.`).
- Names come from `names.txt`; numbers in digits are numbers. A sentence written for two words (the same text
  in two blocks, same translation) becomes one sentence with two targets.
- 5 to 8 sentences per card word (`publish.word_min_targets` is 5), each a different situation, short at A1
  (4 to 8 words), natural, with the Persian a learner would say.

## Grammar units: `content/<language>/grammar/<LEVEL>/NN-name.txt`

One unit per file (PRD §6, §14.6); file names give the teaching order within a level, and the unit code is
unique across the language.

```
code: fr-a1-etre-present
title: فعل être در زمان حال
scope: je suis، tu es، il est، nous sommes، vous êtes، ils sont
can_do: می‌توانی بگویی کی هستی و حالت چطور است.
rule: être یعنی «بودن» و بی‌قاعده است: je suis، tu es، il est …
mistake: فارسی‌زبان‌ها گاهی می‌گویند «je es»؛ درست: je suis.
tables: présent | être
lesson:
… the Persian lesson, any number of lines (blank lines are kept) …
table:
ضمیر | être
je | suis
sets:
مذکر: le père, le livre
examples:
Je suis étudiant. | من دانشجو هستم.
targets:
Je [suis] content. | من خوشحالم. | d: es, est, sommes | hint: (être)
Nous [sommes] à Paris et vous [êtes] à Lyon. | ما در پاریس هستیم و شما در لیون. | d: sont, êtes, suis / sommes, es, sont
transforms:
Je suis content. => Nous sommes contents. ; Nous sommes contentes. | جمله را با nous بنویس.
translations:
من خسته‌ام. => Je suis fatigué. ; Je suis fatiguée.
```

- Headers `code`, `title`, `scope`, `rule`, `mistake` and a `lesson` are required; `can_do` is shown at the
  end of the unit. `table` and `sets` are optional.
- `examples` (at least 3) have no gap. `targets` have one or two `[gaps]`: `d:` three wrong options per gap
  (the gaps apart with « / »), `ok:` other right answers per gap, `hint:`, and `full:` other right word
  orders of the whole sentence (« ; »). A unit needs 30 targets to be published (`publish.unit_min_targets`).
- `transforms`: «source => output ; other right output | Persian instruction». `translations`: «Persian
  sentence => right answer ; other right answer».
- Every word of the unit must be of its level or lower and in the word lists.
- `tables: <tense>` makes this unit the home of that tense's conjugation tables (the tense as written in
  `conjugation.tenses.<language>`). `tables: <tense> | <class>` claims one class of verbs: a verb's lemma
  (`être`), or `irregular`, `reflexive`, `aux-etre` (French: also `er`, `ir`) and `regular`, `irregular`,
  `modal`, `separable`, `reflexive`, `aux-sein` (German). The most specific unit at or below the table's
  level wins. Once a level has grammar, every tense of that level needs a unit.
- Review cards (`review_card`) go to a verb whose forms in that tense leave its group's pattern and to the
  first verb of each regular group as its sample.
