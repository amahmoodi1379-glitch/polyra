/**
 * Function words and their forms, by the lemma a word list files them under (content/README.md: the
 * masculine singular base, `le` for la, les and l'). The open lexicons file most of these under each
 * form (Lexique's lemma of «la» is «la»), so the content packs read them from here.
 */

const table = (rows: Record<string, string>) => {
  const out = new Map<string, string[]>();
  for (const [lemma, forms] of Object.entries(rows)) {
    for (const form of forms.split(/\s+/)) out.set(form, [...(out.get(form) ?? []), lemma]);
  }
  return out;
};

const french = table({
  le: "le la les l'",
  un: "un une des",
  des: "des",
  du: "du",
  de: "de d' du des",
  au: "au aux",
  à: "à au aux",
  ce: "ce c' cet cette ces",
  cet: "cet",
  mon: "mon ma mes",
  ton: "ton ta tes",
  son: "son sa ses",
  notre: "notre nos",
  votre: "votre vos",
  leur: "leur leurs",
  quel: "quel quelle quels quelles",
  lequel: "lequel laquelle lesquels lesquelles auquel auxquels auxquelles duquel desquels desquelles",
  celui: "celui celle ceux celles",
  tout: "tout toute tous toutes",
  aucun: "aucun aucune",
  certain: "certain certaine certains certaines",
  quelque: "quelque quelques",
  plusieurs: "plusieurs",
  autre: "autre autres",
  même: "même mêmes",
  chaque: "chaque",
  je: "je j'",
  me: "me m'",
  te: "te t'",
  se: "se s'",
  ne: "ne n'",
  que: "que qu'",
  si: "si s'",
  jusque: "jusque jusqu'",
  lorsque: "lorsque lorsqu'",
  puisque: "puisque puisqu'",
  quoique: "quoique quoiqu'",
  il: "il ils",
  elle: "elle elles",
  lui: "lui",
  eux: "eux",
  moi: "moi",
  toi: "toi",
  nous: "nous",
  vous: "vous",
  on: "on",
  tu: "tu",
  y: "y",
  en: "en",
  qui: "qui",
  quoi: "quoi",
  dont: "dont",
  où: "où",
  "le mien": "mien mienne miens miennes",
  "le tien": "tien tienne tiens tiennes",
  "le sien": "sien sienne siens siennes",
  "le nôtre": "nôtre nôtres",
  "le vôtre": "vôtre vôtres",
  "le leur": "leur leurs",
});

const german = table({
  der: "der die das den dem des",
  die: "die der den",
  das: "das dem des",
  ein: "ein eine einen einem einer eines",
  kein: "kein keine keinen keinem keiner keines",
  mein: "mein meine meinen meinem meiner meines",
  dein: "dein deine deinen deinem deiner deines",
  sein: "sein seine seinen seinem seiner seines",
  ihr: "ihr ihre ihren ihrem ihrer ihres",
  Ihr: "Ihr Ihre Ihren Ihrem Ihrer Ihres",
  unser: "unser unsere unseren unserem unserer unseres unsre unsren unsrem unsrer unsres",
  euer: "euer eure euren eurem eurer eures",
  dieser: "dieser diese diesen diesem dieses dies",
  jeder: "jeder jede jeden jedem jedes",
  welcher: "welcher welche welchen welchem welches",
  jener: "jener jene jenen jenem jenes",
  mancher: "mancher manche manchen manchem manches",
  alle: "alle allen aller alles all",
  aller: "aller alle allen allem alles",
  ich: "ich mich mir meiner",
  du: "du dich dir deiner",
  er: "er ihn ihm seiner",
  sie: "sie ihr ihnen ihrer",
  Sie: "Sie Ihnen Ihrer",
  es: "es ihm seiner",
  wir: "wir uns unser",
  // «ihr» (you, plural) has the same forms as the possessive: the list's own codes tell them apart.
  sich: "sich",
  man: "man einen einem",
  wer: "wer wen wem wessen",
  was: "was",
  jemand: "jemand jemanden jemandem",
  niemand: "niemand niemanden niemandem",
  zum: "zum",
  zur: "zur",
  im: "im",
  am: "am",
  ins: "ins",
  ans: "ans",
  beim: "beim",
  vom: "vom",
  zu: "zu zum zur",
  in: "in im ins",
  an: "an am ans",
  bei: "bei beim",
  von: "von vom",
});

/** Every function-word form of a language with the lemmas it may be filed under. */
export const closedTable = (language: string): ReadonlyMap<string, string[]> => (language === "fr" ? french : german);

/** The forms the table files under a lemma (quel: quel, quelle, quels, quelles), elided ones left out. */
export function closedForms(language: string, lemma: string): string[] {
  const out: string[] = [];
  for (const [form, lemmas] of closedTable(language)) if (lemmas.includes(lemma) && !form.endsWith("'")) out.push(form);
  return out;
}

/** Lemmas a function-word form may be filed under, by language; the exact form first, then lower case. */
export function closedLemmas(language: string, surface: string): string[] {
  const forms = language === "fr" ? french : german;
  const exact = forms.get(surface) ?? [];
  const lower = surface.toLowerCase() === surface ? [] : (forms.get(surface.toLowerCase()) ?? []);
  return [...new Set([...exact, ...lower])];
}

/** French elided forms end in an apostrophe in the text (l', j', qu', jusqu'). */
export const ELIDED = new Set(["l", "j", "m", "t", "s", "n", "c", "d", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu"]);

/** German separable prefixes that stand alone at the end of a clause (stehe … auf). */
export const SEPARABLE = [
  "ab", "an", "auf", "aus", "bei", "dabei", "dar", "durch", "ein", "entgegen", "fern", "fest", "fort", "her", "heraus", "herein", "herum", "herunter",
  "hin", "hinaus", "hinein", "hinunter", "kennen", "los", "mit", "nach", "nieder", "spazieren", "statt", "teil", "um", "vor", "voran", "vorbei",
  "weg", "weiter", "wieder", "zu", "zurecht", "zurück", "zusammen", "bekannt", "frei", "gut", "schief", "sitzen", "stehen", "verloren", "weh", "leid"
];
