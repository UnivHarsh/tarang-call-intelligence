/**
 * Script and spelling normalisation for code-mixed Hindi and English.
 *
 * The problem this file exists for: a Hinglish reference transcript is written
 * in Roman script, and an ASR system may return the same words in Devanagari.
 * Scored naively, "नहीं आया" against "nahi aaya" is two substitutions out of
 * two words — a 100% word error rate for a transcript that is completely
 * correct. Any WER number reported on Indic code-mixed speech is therefore a
 * statement about the scoring convention at least as much as about the model.
 *
 * So the normalisation is deliberately staged rather than baked in. The bench
 * reports WER after each stage, which turns a single unfalsifiable number into
 * a decomposition: this much was script, this much was spelling, this much was
 * numbers, and the remainder is what the recogniser actually got wrong.
 *
 * Two honest caveats, kept visible on the results page:
 *   - Devanagari to Roman here is a transliteration, not a transcription. The
 *     inherent schwa is dropped with a simple word-final rule, which is right
 *     far more often than it is wrong and is wrong often enough to matter.
 *   - The variant table is curated from this corpus, not learned. It covers the
 *     high-frequency support vocabulary and nothing else, which is the correct
 *     scope for a domain benchmark and the wrong scope for a general claim.
 */

/** Devanagari dependent vowel signs (matras) and their Roman values. */
const MATRA = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॅ": "e", "ॉ": "o",
};

/** Independent vowels. */
const VOWEL = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u",
  "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o",
  "औ": "au", "ऍ": "e", "ऑ": "o",
};

/** Consonants, carrying their inherent 'a'. */
const CONS = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h",
  "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r",
  "ढ़": "rh", "फ़": "f", "य़": "y",
};

const NUKTA = "़";
const VIRAMA = "्";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export const hasDevanagari = (s) => /[ऀ-ॿ]/.test(String(s || ""));

/**
 * Transliterates Devanagari to Roman, leaving any Latin characters untouched so
 * that code-mixed input survives the pass. Word-final inherent 'a' is dropped,
 * which is the single rule that makes the output look like how people actually
 * write Hinglish rather than like a Sanskrit transliteration.
 */
export function devanagariToRoman(input) {
  const src = String(input || "");
  let out = "";
  let pendingA = false; // a consonant has been emitted and still owns its inherent vowel

  const flush = (atBoundary) => {
    if (pendingA && !atBoundary) out += "a";
    pendingA = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === NUKTA) continue;

    if (CONS[ch]) {
      flush(false);
      out += CONS[ch];
      pendingA = true;
      continue;
    }
    if (MATRA[ch]) {
      pendingA = false;
      out += MATRA[ch];
      continue;
    }
    if (VOWEL[ch]) {
      flush(false);
      out += VOWEL[ch];
      continue;
    }
    if (ch === VIRAMA) {
      pendingA = false;
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      // Both surface as a nasal; in Roman Hinglish that is almost always 'n'.
      pendingA = false;
      out += "n";
      continue;
    }
    if (ch === VISARGA) {
      flush(false);
      out += "h";
      continue;
    }
    const digit = DEVANAGARI_DIGITS.indexOf(ch);
    if (digit >= 0) {
      flush(true);
      out += String(digit);
      continue;
    }
    // Anything else: a space, Latin text, punctuation. Word boundary.
    const boundary = !next || /\s/.test(ch) || !/[ऀ-ॿ]/.test(ch);
    flush(boundary);
    out += ch;
  }
  flush(true);
  return out;
}

/**
 * Hinglish spelling variants that mean the same word.
 *
 * Key is the canonical form. These are the tokens that actually recur in
 * support calls, collected from the corpus rather than from a dictionary: the
 * point is to stop penalising a recogniser for choosing "nahin" over "nahi",
 * not to build a transliteration standard.
 */
const VARIANTS = {
  nahi: ["nahin", "nahee", "nahii", "nhi", "nai"],
  haan: ["han", "haa", "ha", "haanji", "haanjee"],
  hai: ["hain", "he", "hei"],
  kya: ["kia", "kyaa"],
  kaise: ["kaisay", "kese", "kaise"],
  kar: ["kr"],
  karo: ["kro", "karro"],
  karna: ["krna", "karnaa"],
  raha: ["rha", "rahaa"],
  rahi: ["rhi", "rahee"],
  hua: ["hoa", "huaa"],
  hui: ["huee", "hoi"],
  gaya: ["gya", "gayaa"],
  gayi: ["gyi", "gai"],
  mujhe: ["muje", "mujhay"],
  aapka: ["apka", "aapkaa"],
  aap: ["ap"],
  mera: ["mere", "meraa"],
  paisa: ["paise", "paisaa", "pese"],
  rupaye: ["rupee", "rupees", "rupya", "rupaya", "rs"],
  wapas: ["vapas", "wapis", "vaapas"],
  bhej: ["bej", "bhejh"],
  milega: ["milegaa", "milge"],
  order: ["aarder", "ardar", "orderr"],
  refund: ["rifund", "refand"],
  delivery: ["dilivery", "delevery", "deliveri"],
  cancel: ["kensal", "cancle"],
  pickup: ["pick-up", "pikup"],
  complaint: ["complain", "komplent"],
  package: ["packet", "pakket"],
  address: ["adress", "addres"],
  problem: ["problam", "prablem"],
  online: ["onlain"],
  update: ["updet", "apdate"],
  status: ["stetus"],
  kharab: ["karab", "kharaab"],
  theek: ["thik", "teek", "thk"],
  jaldi: ["jldi", "jaldee"],
  abhi: ["abhee", "abi"],
  time: ["taim"],
  please: ["plz", "pls"],
  sorry: ["sory"],
  thoda: ["thora", "thodaa"],
  bahut: ["bohot", "bahot", "bhot"],
  koi: ["koee"],
  kuch: ["kuchh", "kch"],
  baar: ["bar", "baarr"],
  din: ["dinn"],
  ghar: ["ghar"],
  paas: ["pas"],
  liye: ["liya", "lie"],
  saath: ["sath"],
  baat: ["bat", "baath"],
};

const CANON = (() => {
  const m = new Map();
  for (const [canon, alts] of Object.entries(VARIANTS)) {
    m.set(canon, canon);
    for (const a of alts) m.set(a, canon);
  }
  return m;
})();

export const canonicalVariant = (tok) => CANON.get(tok) || tok;

/** Spoken numbers, Hindi and English, up to the range support calls use. */
const NUMBER_WORDS = {
  zero: 0, ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4,
  four: 4, paanch: 5, panch: 5, five: 5, chah: 6, chhah: 6, six: 6, saat: 7,
  seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10,
  gyarah: 11, eleven: 11, barah: 12, twelve: 12, thirteen: 13, fourteen: 14,
  pandrah: 15, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, bees: 20, twenty: 20, tees: 30, thirty: 30, chalis: 40,
  forty: 40, pachas: 50, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90, sau: 100, hundred: 100, hazaar: 1000, hazar: 1000,
  thousand: 1000, lakh: 100000,
};

export const numberWord = (tok) =>
  Object.prototype.hasOwnProperty.call(NUMBER_WORDS, tok) ? NUMBER_WORDS[tok] : null;

/** Filler tokens that carry no content and that recognisers emit inconsistently. */
export const FILLERS = new Set([
  "um", "uh", "umm", "uhh", "hmm", "hm", "er", "ah", "aa", "matlab", "yaani",
  "actually", "basically", "okay", "ok", "acha", "achha", "arre", "arey", "toh",
  "to", "na", "ji", "sir", "madam", "maam",
]);
