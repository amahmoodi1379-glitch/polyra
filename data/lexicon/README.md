# Noun lexicons

Gender and plural of the nouns in the frequency lists (`data/frequency`), for the check of a new or
imported word (`src/server/content/lexicon.ts`). A word whose gender or plural differs from the lexicon
gets a warning in the batch report; nothing is refused, since a lexicon has gaps.

| File | Source | Licence |
| --- | --- | --- |
| `fr-nouns.tsv` | Lexique 3.83, nouns with `genre` and `nombre`. New, B., Pallier, C., Brysbaert, M., Ferrand, L. (2004). Lexique 2: A New French Lexical Database. www.lexique.org | CC BY-SA 4.0 |
| `de-nouns.tsv` | german-nouns by gambolputty (github.com/gambolputty/german-nouns), compiled from de.wiktionary.org | CC BY-SA 4.0 |

Both files are adaptations of their sources and are shared under CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/). The app names both sources on its about page.

Format, one noun per line: `lemma<TAB>gender=plural|plural;gender=…`. French genders are `m` and `f`,
German ones `der`, `die` and `das`; an empty plural means none is known.

To rebuild after downloading the sources:

```
npx tsx scripts/data/build-lexicon.ts Lexique383.tsv nouns.csv
```

## Word forms

`fr-forms.tsv` and `de-forms.tsv` list the inflected forms of the lemmas in `data/frequency` with the lemmas they may belong to, for the content
packs (`src/server/content/packs/morph.ts`): which word of the lists a form in a sentence is, and the matching
form of another word for a wrong option. French from Lexique 3.83 (all categories), German from german-nouns
(nouns with their cases); German verbs come from Morphy (`german-verbs-dict`) and German adjective endings
are made by rule. Same sources and licence as above.

Format, one form per line: `form<TAB>lemma|category|gender-number|frequency;…`.

```
npx tsx scripts/data/build-forms.ts Lexique383.tsv nouns.csv
```
