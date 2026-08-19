/**
 * Builds the seeded call corpus.
 *
 * Two rules govern this file:
 *  1. Fully deterministic. Same seed in, byte-identical JSON out, on any machine.
 *  2. The insight fields are ground truth, not decoration. They are authored
 *     alongside the transcript, which means the corpus doubles as a labelled
 *     eval set for the real LLM extractor (see scripts/eval-extraction.mjs).
 *
 * Three patterns are deliberately buried in the data so that the dashboard has
 * something real to find:
 *   - a cold-chain failure ramping through the monsoon weeks in the west/south
 *   - a coupon bug that only appears on Android, starting week 4
 *   - a 3PL handover in Delhi NCR that breaks in week 2 and recovers by week 6
 * None of them are labelled as such anywhere. They have to be discovered.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, wrinkleCompetitor } from "./corpus/scenarios.mjs";
import {
  mulberry32, pick, pickN, chance, intBetween, clamp, round2,
  FIRST_NAMES, LAST_NAMES, CATALOG, CATEGORY_KEYS, COLD_CHAIN, FRAGILE,
  weightedCity, timeline,
} from "./corpus/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "data");

const SEED = 20260820;
const WEEKS = 8;
const CALLS_PER_WEEK = [95, 100, 106, 112, 118, 126, 134, 142];
/** Corpus ends the day before "today" in the demo timeline. */
const CORPUS_END = Date.UTC(2026, 7, 20);

const HUBS = {
  Bengaluru: "Bommasandra",
  Mumbai: "Bhiwandi",
  "Delhi NCR": "Ghaziabad",
  Hyderabad: "Medchal",
  Pune: "Chakan",
  Chennai: "Sriperumbudur",
  Ahmedabad: "Changodar",
  Jaipur: "Sitapura",
  Lucknow: "Amausi",
};

/**
 * Per-week frequency multipliers. This is where the three storylines live.
 * Index = week number, 0 = oldest.
 */
const ARCS = {
  cold_chain_melt:        [0.3, 0.4, 0.5, 0.8, 2.2, 4.2, 5.4, 6.2],
  coupon_app_bug:         [0.0, 0.0, 0.0, 0.0, 0.2, 0.9, 2.8, 3.8],
  coupon_app_bug_english: [0.0, 0.0, 0.0, 0.0, 0.2, 1.0, 2.9, 3.9],
  delivery_delay_3pl:     [0.9, 1.0, 1.8, 2.0, 1.6, 1.1, 0.9, 0.85],
  return_pickup_missed:   [0.8, 0.9, 1.3, 1.5, 1.2, 1.0, 0.9, 0.9],
  order_tracking_simple:  [1.2, 1.2, 1.1, 1.0, 1.0, 0.9, 0.85, 0.8],
};

/** The Delhi NCR 3PL handover: delay complaints concentrate there, then fade. */
const CITY_ARCS = {
  delivery_delay_3pl: (w) => {
    const m = [1, 1.3, 7.0, 8.0, 5.0, 2.2, 1.1, 1.0][w];
    return { "Delhi NCR": m };
  },
  delivery_delay_english: (w) => ({ "Delhi NCR": [1, 1.3, 7.0, 8.0, 5.0, 2.2, 1.1, 1.0][w] }),
  return_pickup_missed: (w) => ({ "Delhi NCR": [1, 1, 3.4, 3.8, 2.6, 1.5, 1, 1][w] }),
};

const MOOD_MIX = {
  feedback_positive: { warm: 1 },
  order_tracking_simple: { calm: 0.72, warm: 0.2, annoyed: 0.08 },
  address_change: { calm: 0.7, warm: 0.25, annoyed: 0.05 },
  default: { calm: 0.4, annoyed: 0.33, angry: 0.22, warm: 0.05 },
};

function pickMood(rng, key) {
  const mix = MOOD_MIX[key] || MOOD_MIX.default;
  let r = rng();
  for (const [mood, p] of Object.entries(mix)) {
    r -= p;
    if (r <= 0) return mood;
  }
  return "calm";
}

function pickScenario(rng, week) {
  const pool = SCENARIOS.map((s) => ({
    s,
    w: s.weight * (ARCS[s.key] ? ARCS[s.key][week] : 1),
  })).filter((x) => x.w > 0);
  const total = pool.reduce((a, b) => a + b.w, 0);
  let r = rng() * total;
  for (const x of pool) {
    r -= x.w;
    if (r <= 0) return x.s;
  }
  return pool[pool.length - 1].s;
}

function makeCustomer(rng, city, idx) {
  const lifetimeOrders = chance(rng, 0.22)
    ? intBetween(rng, 1, 3)
    : chance(rng, 0.5)
      ? intBetween(rng, 4, 14)
      : intBetween(rng, 15, 90);
  const segment =
    lifetimeOrders <= 3 ? "new" : lifetimeOrders <= 14 ? "growing" : lifetimeOrders <= 45 ? "loyal" : "vip";
  return {
    id: `KC${String(100000 + idx * 37 + intBetween(rng, 0, 30)).slice(0, 6)}`,
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    city,
    segment,
    lifetimeOrders,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function makeOrder(rng, scenario, city, startedMs, idx) {
  let category = pick(rng, CATEGORY_KEYS);
  let items;
  if (scenario.coldChain) {
    category = chance(rng, 0.5) ? "Dairy" : "Chocolate";
    items = [pick(rng, COLD_CHAIN), ...pickN(rng, CATALOG.Grocery, intBetween(rng, 1, 2))];
  } else if (scenario.consumable) {
    category = pick(rng, ["Grocery", "Dairy", "Beverages", "Baby"]);
    items = pickN(rng, CATALOG[category], Math.min(2, CATALOG[category].length));
  } else if (scenario.fragile) {
    category = "Grocery";
    items = [pick(rng, FRAGILE), ...pickN(rng, CATALOG.Home, intBetween(rng, 1, 2))];
  } else {
    items = pickN(rng, CATALOG[category], intBetween(rng, 1, 3));
    if (items.length < 2) items.push(pick(rng, CATALOG[pick(rng, CATEGORY_KEYS)]));
  }
  const valueInr = intBetween(rng, 3, 26) * 50 + intBetween(rng, 0, 9) * 10 + 9;
  const placedMs = startedMs - intBetween(rng, 1, 6) * 86400000;
  const promisedMs = placedMs + intBetween(rng, 1, 3) * 86400000;
  const d = new Date(placedMs);
  return {
    id: `KTL-${String(48000 + idx * 7).slice(0, 5)}-${String.fromCharCode(65 + (idx % 26))}${intBetween(rng, 10, 99)}`,
    valueInr,
    category,
    items,
    placedAt: new Date(placedMs).toISOString(),
    placedShort: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
    promisedAt: new Date(promisedMs).toISOString(),
    status: pick(rng, ["in_transit", "delivered", "out_for_delivery", "packed"]),
    hub: HUBS[city] || "Bommasandra",
  };
}

/** Compliance is read back out of the transcript, so it can never contradict it. */
function scoreCompliance(turns, order) {
  const agentText = turns.filter((t) => t.role === "agent").map((t) => t.text);
  const joined = agentText.join(" ");
  return {
    greeting: /namaste|hello/i.test(agentText[0] || ""),
    identityVerified: joined.includes(order.id),
    empathyShown: /sorry|khed|samajh sakti|bura laga|acceptable nahi|bilkul theek nahi/i.test(joined),
    correctPolicyQuoted: /working days|ghante|priority flag|exclusion|refuse-on-delivery|batch/i.test(joined),
    closedTheLoop: /dhanyavaad|thank you|dobara call/i.test(agentText[agentText.length - 1] || ""),
  };
}

/** Language label is derived from the text so it always matches what is shown. */
function detectLanguage(turns) {
  const text = turns.map((t) => t.text).join(" ").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const hindiTokens =
    (text.match(
      /\b(hai|hain|nahi|kya|mera|aapka|aapke|karo|kar|raha|rahi|ho|gaya|gayi|bhej|dijiye|theek|abhi|baar|din|paise|matlab|thoda|bilkul|haan|main|mujhe|koi|kuch|wahi|yahi|jo|to|se|ke|ki|ka|mein)\b/g,
    ) || []).length;
  const ratio = hindiTokens / Math.max(1, words.length);
  if (ratio < 0.06) return "english";
  if (ratio > 0.34) return "hindi";
  return "hinglish";
}

/** Lookups and hold requests. Only plausible while the agent is still working
 *  the problem, never while closing the call. */
const FILLER_LOOKUP = [
  "Bas ek minute, system thoda slow chal raha hai.",
  "Main aapko hold pe rakhti hoon 20 second ke liye, theek hai?",
  "Thank you for holding, main aapke saath hoon.",
  "Ek baar main aapka registered number confirm kar lun, last four digits?",
];
/** Safe anywhere — someone confirming they are still on the line. */
const FILLER_BACKCHANNEL = ["Haan ji, main line pe hoon.", "Ji, main sun rahi hoon."];

const FILLER_CUST = [
  "Haan theek hai.",
  "Ji.",
  "Hmm.",
  "Haan haan, main hoon.",
  "Okay.",
  "Sun raha hoon.",
];

/**
 * Inserts hold time and backchannel into the middle of a call. Scripted
 * transcripts are uniformly efficient; real ones are not, and average handle
 * time is meaningless if the corpus never contains a lookup pause.
 */
function padWithDeadAir(rng, turns) {
  const inserts = intBetween(rng, 1, 3);
  for (let i = 0; i < inserts; i++) {
    // Keep inserts inside the working half of the call. Dropping "let me put
    // you on hold" in between the resolution and the goodbye reads as a bug to
    // anyone who has actually been on a support call.
    const lastWorkingTurn = Math.max(3, Math.floor(turns.length * 0.6));
    const at = intBetween(rng, 2, lastWorkingTurn);
    const early = at <= Math.floor(turns.length * 0.45);
    turns.splice(
      at,
      0,
      { role: "agent", text: pick(rng, early ? FILLER_LOOKUP : FILLER_BACKCHANNEL) },
      { role: "customer", text: pick(rng, FILLER_CUST) },
    );
  }
  return turns;
}

function build() {
  const rng = mulberry32(SEED);
  const calls = [];
  let idx = 0;

  for (let week = 0; week < WEEKS; week++) {
    const weekStart = CORPUS_END - (WEEKS - week) * 7 * 86400000;
    const n = CALLS_PER_WEEK[week];

    for (let k = 0; k < n; k++) {
      idx++;
      const scenario = pickScenario(rng, week);

      const cityBias = { ...(scenario.cityBias || {}) };
      const cityArc = CITY_ARCS[scenario.key] ? CITY_ARCS[scenario.key](week) : {};
      for (const [c, m] of Object.entries(cityArc)) cityBias[c] = (cityBias[c] || 1) * m;
      const city = weightedCity(rng, cityBias);

      // Calls land inside working hours, with the usual mid-morning and
      // post-dinner double hump.
      const dayOffset = intBetween(rng, 0, 6);
      const hour = chance(rng, 0.55) ? intBetween(rng, 9, 13) : intBetween(rng, 17, 21);
      const startedMs = weekStart + dayOffset * 86400000 + hour * 3600000 + intBetween(rng, 0, 59) * 60000;

      const customer = makeCustomer(rng, city, idx);
      const order = makeOrder(rng, scenario, city, startedMs, idx);
      const mood = pickMood(rng, scenario.key);
      const days = intBetween(rng, 2, 5);

      const built = scenario.build({ rng, order, mood, days, city, week });
      let rawTurns = padWithDeadAir(rng, [...built.turns]);

      // Wrinkle: a churn-risk customer name-drops a competitor. Inserted before
      // the closing turn so it reads naturally.
      let competitorMentions = [];
      const baseChurn = built.gt.churnRisk ?? 0.2;
      if (baseChurn > 0.28 && chance(rng, 0.3)) {
        const w = wrinkleCompetitor(rng, mood);
        if (w) {
          rawTurns.splice(rawTurns.length - 1, 0, w.turn);
          rawTurns.splice(rawTurns.length - 1, 0, {
            role: "agent",
            text: "Main samajh sakti hoon, aur main nahi chahti ki aap aisa feel karein. Jo maine abhi kiya hai wo aaj hi effect mein aa jayega.",
          });
          competitorMentions = [w.comp];
        }
      }

      const turns = timeline(rng, rawTurns);
      const durationSec = Math.round((turns[turns.length - 1].tMs + 4000) / 1000);

      // Early-weeks agent immaturity: some otherwise contained calls fall over
      // to a human. This decays, which is what makes containment trend up.
      let contained = built.gt.contained ?? true;
      let resolution = built.gt.resolution;
      let handoffReason = built.gt.handoffReason ?? null;
      const failP = Math.max(0.11, 0.3 - week * 0.027);
      if (contained && chance(rng, failP)) {
        contained = false;
        resolution = "escalated_human";
        handoffReason = pick(rng, [
          "Agent could not complete the refund action and transferred to a human",
          "Customer repeated the question three times without being understood",
          "Requested an exception outside the agent policy scope",
        ]);
      }

      const quotes = (built.gt.quoteIdx || [])
        .map(({ i, tag }) => {
          const t = turns[i];
          return t ? { text: t.text, tMs: t.tMs, tag } : null;
        })
        .filter(Boolean);

      const transcriptText = turns.map((t) => t.text).join(" ");
      const productMentions = order.items.filter((it) =>
        transcriptText.toLowerCase().includes(it.toLowerCase().slice(0, 14)),
      );

      const asrWer = round2(clamp(1 - turns.reduce((s, t) => s + t.conf, 0) / turns.length + (rng() * 0.03 - 0.01), 0.02, 0.3));

      const call = {
        id: `c_${String(idx).padStart(4, "0")}`,
        startedAt: new Date(startedMs).toISOString(),
        durationSec,
        direction: scenario.outbound ? "outbound" : "inbound",
        handledBy: contained ? "voice_agent" : "human_agent",
        language: detectLanguage(turns),
        customer,
        order: {
          id: order.id,
          valueInr: order.valueInr,
          category: order.category,
          items: order.items,
          placedAt: order.placedAt,
          promisedAt: order.promisedAt,
          status: order.status,
        },
        transcript: turns,
        asrWer,

        summary: built.gt.summary,
        primaryIntent: scenario.intent,
        secondaryIntents: built.gt.secondaryIntents || [],
        rootCause: scenario.rootCause,
        rootCauseNote: built.gt.rootCauseNote,
        sentimentStart: round2(clamp(built.gt.sentimentStart + (rng() * 0.12 - 0.06), -1, 1)),
        sentimentEnd: round2(clamp((contained ? built.gt.sentimentEnd : built.gt.sentimentEnd - 0.25) + (rng() * 0.12 - 0.06), -1, 1)),
        csatPredicted: clamp(Math.round(built.gt.csatPredicted - (contained ? 0 : 1)), 1, 5),
        resolved: contained ? built.gt.resolved : false,
        resolution,
        contained,
        handoffReason,
        escalationRisk: round2(clamp(built.gt.escalationRisk + (contained ? 0 : 0.2) + (rng() * 0.08 - 0.04), 0, 1)),
        churnRisk: round2(clamp(baseChurn + (competitorMentions.length ? 0.18 : 0) + (rng() * 0.08 - 0.04), 0, 1)),
        repeatCaller: Boolean(built.gt.repeatCaller),
        refundRequested: Boolean(built.gt.refundRequested),
        refundAmountInr: built.gt.refundAmountInr || 0,
        productMentions,
        competitorMentions,
        policyFriction: built.gt.policyFriction || [],
        agentCompliance: scoreCompliance(turns, order),
        quotes,
        productSignal: built.gt.productSignal || null,
        tags: built.gt.tags || [],
        nextBestAction: built.gt.nextBestAction,
        extractedBy: "seed",
        scenarioKey: scenario.key,
      };

      calls.push(call);
    }
  }

  calls.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return calls;
}

const calls = build();

// A fixed, stratified eval slice so the harness scores the same calls each run.
const byScenario = {};
for (const c of calls) (byScenario[c.scenarioKey] ||= []).push(c.id);
const evalIds = Object.values(byScenario).flatMap((ids) => ids.filter((_, i) => i % Math.ceil(ids.length / 3) === 0)).slice(0, 45);

fs.mkdirSync(OUT_DIR, { recursive: true });

const index = calls.map(({ transcript, ...rest }) => rest);
const transcripts = Object.fromEntries(calls.map((c) => [c.id, c.transcript]));

fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));
fs.writeFileSync(path.join(OUT_DIR, "transcripts.json"), JSON.stringify(transcripts));
fs.writeFileSync(
  path.join(OUT_DIR, "meta.json"),
  JSON.stringify(
    {
      generatedFrom: "scripts/generate-corpus.mjs",
      seed: SEED,
      brand: "Kartly",
      brandNote: "Kartly is a fictional D2C grocery and household retailer. No real customer data is used anywhere in this project.",
      weeks: WEEKS,
      corpusEnd: new Date(CORPUS_END).toISOString(),
      totalCalls: calls.length,
      totalTurns: calls.reduce((a, c) => a + c.transcript.length, 0),
      scenarios: Object.keys(byScenario).length,
      evalIds,
    },
    null,
    2,
  ),
);

const dist = {};
for (const c of calls) dist[c.primaryIntent] = (dist[c.primaryIntent] || 0) + 1;
console.log(`corpus: ${calls.length} calls across ${WEEKS} weeks, ${Object.keys(byScenario).length} scenarios`);
console.log(`eval slice: ${evalIds.length} calls`);
console.log("intent mix:", Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
console.log(`languages:`, [...new Set(calls.map((c) => c.language))].join(", "));
console.log(`containment: wk1=${pctContained(calls, 0)}%  wk8=${pctContained(calls, 7)}%`);

function pctContained(all, week) {
  const start = CORPUS_END - (WEEKS - week) * 7 * 86400000;
  const end = start + 7 * 86400000;
  const slice = all.filter((c) => {
    const t = Date.parse(c.startedAt);
    return t >= start && t < end;
  });
  if (!slice.length) return 0;
  return Math.round((slice.filter((c) => c.contained).length / slice.length) * 100);
}
