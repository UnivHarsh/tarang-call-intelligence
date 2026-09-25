/**
 * Word error rate, character error rate, and the normalisation ladder.
 *
 * WER on its own is a weak claim on code-mixed speech, because most of the
 * decisions that move it are made by the person scoring rather than by the
 * recogniser. This module makes those decisions explicit and ordered, so the
 * bench can report the same pair of transcripts at seven levels of leniency and
 * show where the errors actually live.
 *
 * The ladder is cumulative and deliberately ordered from "nobody would argue"
 * to "defensible but a choice":
 *
 *   0 raw        nothing at all
 *   1 case       lowercase, collapse whitespace
 *   2 punct      strip punctuation
 *   3 script     Devanagari transliterated to Roman, so both sides share one
 *   4 spelling   Hinglish spelling variants collapsed to one form
 *   5 numbers    spoken numerals rendered as digits
 *   6 entities   order ids and currency amounts normalised
 *   7 fillers    discourse markers dropped from both sides
 *
 * A system that looks bad at level 2 and fine at level 4 does not have an
 * accuracy problem, it has a transliteration problem, and those are fixed in
 * completely different places. That distinction is the reason this file exists.
 */

import {
  devanagariToRoman, canonicalVariant, numberWord, FILLERS, hasDevanagari,
} from "./translit.mjs";

export const STAGES = [
  { key: "raw", label: "Raw", note: "No normalisation at all" },
  { key: "case", label: "Case", note: "Lowercased, whitespace collapsed" },
  { key: "punct", label: "Punctuation", note: "Punctuation stripped" },
  { key: "script", label: "Script", note: "Devanagari transliterated to Roman" },
  { key: "spelling", label: "Spelling", note: "Hinglish variants collapsed" },
  { key: "numbers", label: "Numbers", note: "Spoken numerals as digits" },
  { key: "entities", label: "Entities", note: "Order ids and amounts normalised" },
  { key: "fillers", label: "Fillers", note: "Discourse markers dropped" },
];

const upTo = (stage) => {
  const i = STAGES.findIndex((s) => s.key === stage);
  return new Set(STAGES.slice(0, i + 1).map((s) => s.key));
};

/**
 * Order ids in this corpus look like KTL-48476-Q75. Recognisers routinely
 * return them spaced, lowercased, or with the hyphens spoken as "dash", so the
 * comparison is made on the squashed alphanumeric form. This is scored as one
 * token either way, which is the honest choice: getting an order id wrong is
 * one failure, not seven.
 */
function normaliseEntities(tokens) {
  // Deliberately narrow: only fragments that look like part of a spelled-out
  // identifier. Ordinary short words must not qualify, or a whole sentence
  // collapses into one token and the metric stops meaning anything.
  const idish = (t) =>
    /^[a-z]{1,2}$/.test(t) || /^\d{1,8}$/.test(t) || /^[a-z]{1,3}\d+$/.test(t) || /^\d+[a-z]{1,3}$/.test(t);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (idish(tokens[i])) {
      let j = i;
      let digits = 0, letters = 0;
      while (j < tokens.length && idish(tokens[j])) {
        digits += (tokens[j].match(/\d/g) || []).length;
        letters += (tokens[j].match(/[a-z]/g) || []).length;
        j++;
      }
      const run = tokens.slice(i, j);
      if (run.length >= 3 && digits >= 4 && letters >= 1) {
        out.push(run.join(""));
        i = j;
        continue;
      }
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

/** Collapses "do hazaar" style constructions into a single numeric token. */
function normaliseNumbers(tokens) {
  const out = [];
  let acc = null;
  const flush = () => {
    if (acc !== null) out.push(String(acc));
    acc = null;
  };
  for (const t of tokens) {
    const v = numberWord(t);
    if (v === null) {
      if (/^\d+$/.test(t)) {
        flush();
        out.push(String(Number(t)));
        continue;
      }
      flush();
      out.push(t);
      continue;
    }
    if (acc === null) acc = v;
    else if (v >= 100) acc = (acc || 1) * v;
    else acc += v;
  }
  flush();
  return out;
}

/**
 * Turns a transcript into the token sequence that will be compared, applying
 * every stage up to and including `stage`.
 */
export function tokenise(text, stage = "fillers") {
  const on = upTo(stage);
  let s = String(text || "");

  if (on.has("script")) s = devanagariToRoman(s);
  if (on.has("case")) s = s.toLowerCase();
  if (on.has("punct")) s = s.replace(/[.,!?;:"'()\[\]{}<>/\\|`~@#$%^&*_+=]/g, " ");
  else s = s.replace(/\s+/g, " ");

  // Hyphens inside identifiers are a scoring artefact rather than speech.
  if (on.has("entities")) s = s.replace(/(\w)[-–](\w)/g, "$1$2");

  let tokens = s.split(/\s+/).filter(Boolean);

  if (on.has("spelling")) tokens = tokens.map(canonicalVariant);
  if (on.has("numbers")) tokens = normaliseNumbers(tokens);
  if (on.has("entities")) tokens = normaliseEntities(tokens);
  if (on.has("fillers")) tokens = tokens.filter((t) => !FILLERS.has(t));

  return tokens;
}

/**
 * Levenshtein alignment over tokens, returning the edit breakdown rather than
 * only the rate. Substitutions, deletions and insertions fail in different
 * ways: a recogniser that deletes is losing audio, one that substitutes is
 * guessing, and one that inserts is hallucinating into silence.
 */
export function align(refTokens, hypTokens) {
  const n = refTokens.length;
  const m = hypTokens.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const bp = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0 ok 1 sub 2 del 3 ins

  for (let i = 0; i <= n; i++) { d[i][0] = i; bp[i][0] = 2; }
  for (let j = 0; j <= m; j++) { d[0][j] = j; bp[0][j] = 3; }
  bp[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = refTokens[i - 1] === hypTokens[j - 1];
      const sub = d[i - 1][j - 1] + (same ? 0 : 1);
      const del = d[i - 1][j] + 1;
      const ins = d[i][j - 1] + 1;
      let best = sub, op = same ? 0 : 1;
      if (del < best) { best = del; op = 2; }
      if (ins < best) { best = ins; op = 3; }
      d[i][j] = best;
      bp[i][j] = op;
    }
  }

  let i = n, j = m;
  const counts = { hits: 0, sub: 0, del: 0, ins: 0 };
  while (i > 0 || j > 0) {
    const op = bp[i][j];
    if (i > 0 && j > 0 && (op === 0 || op === 1)) {
      op === 0 ? counts.hits++ : counts.sub++;
      i--; j--;
    } else if (i > 0 && op === 2) { counts.del++; i--; }
    else { counts.ins++; j--; }
  }
  return counts;
}

export function wer(reference, hypothesis, stage = "fillers") {
  const ref = tokenise(reference, stage);
  const hyp = tokenise(hypothesis, stage);
  const c = align(ref, hyp);
  const denom = ref.length || 1;
  return {
    ...c,
    refWords: ref.length,
    hypWords: hyp.length,
    wer: (c.sub + c.del + c.ins) / denom,
  };
}

/** Character error rate, on the fully normalised strings. */
export function cer(reference, hypothesis, stage = "fillers") {
  const ref = tokenise(reference, stage).join(" ").split("");
  const hyp = tokenise(hypothesis, stage).join(" ").split("");
  const c = align(ref, hyp);
  return (c.sub + c.del + c.ins) / (ref.length || 1);
}

/** WER at every stage of the ladder, for one pair. */
export function ladder(reference, hypothesis) {
  return STAGES.map((s) => ({ stage: s.key, ...wer(reference, hypothesis, s.key) }));
}

/**
 * Aggregates a set of pairs the way a benchmark should: errors over reference
 * words across the whole set, not the mean of per-call rates. Averaging rates
 * lets a ten-word call outvote a two-hundred-word one.
 */
export function aggregate(pairs, stage = "fillers") {
  let sub = 0, del = 0, ins = 0, hits = 0, refWords = 0;
  for (const p of pairs) {
    const r = wer(p.reference, p.hypothesis, stage);
    sub += r.sub; del += r.del; ins += r.ins; hits += r.hits; refWords += r.refWords;
  }
  return {
    stage, sub, del, ins, hits, refWords,
    wer: (sub + del + ins) / (refWords || 1),
    calls: pairs.length,
  };
}

/** Aggregate ladder plus the two splits that matter on code-mixed audio. */
export function report(pairs) {
  const byStage = STAGES.map((s) => aggregate(pairs, s.key));
  const devanagari = pairs.filter((p) => hasDevanagari(p.hypothesis));
  const roman = pairs.filter((p) => !hasDevanagari(p.hypothesis));
  return {
    byStage,
    headline: byStage[byStage.length - 1],
    scriptSplit: {
      devanagari: devanagari.length ? aggregate(devanagari) : null,
      roman: roman.length ? aggregate(roman) : null,
      devanagariShare: pairs.length ? devanagari.length / pairs.length : 0,
    },
  };
}
