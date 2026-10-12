# Frequency lists

Open frequency lists for the word-list step (P-C, PRD §14.5 and §16.2). `npm run seed` loads each file
into `frequency_item` once, when that language has no rows yet. The panel then hands the next 200
unused lines to the P-C prompt.

| File | Source | Licence |
| --- | --- | --- |
| `fr.txt` | Lexique 3.83, lemma frequencies (films and books averaged). New, B., Pallier, C., Brysbaert, M., Ferrand, L. (2004). Lexique 2: A New French Lexical Database. www.lexique.org | CC BY-SA 4.0 |
| `de.txt` | FrequencyWords by Hermit Dave, OpenSubtitles 2018 word forms. github.com/hermitdave/FrequencyWords | CC BY-SA 4.0 |

Both files are adaptations of their sources and are shared under CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/). The app names both sources on its about page.

To rebuild after downloading the sources:

```
npx tsx scripts/data/build-frequency.ts Lexique383.tsv de_50k.txt
```
