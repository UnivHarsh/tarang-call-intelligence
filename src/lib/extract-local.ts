import type { CallInsight, Intent, Resolution, RootCause, Turn } from "./types";
import { ROOT_CAUSE_OWNER } from "./types";

/**
 * Keyword-and-rules extractor.
 *
 * This exists so the whole pipeline still runs end to end with no API key set —
 * a reviewer opening the deployed link should see the real flow, not a
 * "configure your credentials" screen. It is deliberately not disguised as the
 * model: anything it produces is stamped `local-fallback` and the UI says so.
 *
 * It is also the honest baseline. The eval harness scores the LLM against this
 * as well as against ground truth, because "the model beats ground-truth chance"
 * is a weaker claim than "the model beats the regexes anyone could have written
 * in an afternoon".
 */

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/**
 * Ordered most-distinctive first — the first rule that matches wins, so a
 * generic phrase placed early swallows calls that belong elsewhere.
 *
 * Keywords are deliberately narrow. An earlier version matched
 * wrong_or_missing_item on the bare phrase "nahi tha", which meant any caller
 * who said "mujhe pata hi nahi tha" ("I had no idea") was filed as a missing
 * item. That is the characteristic failure mode of keyword classification, and
 * it is worth keeping the baseline honest rather than quietly hand-tuning it
 * until it matches the model.
 */
const INTENT_RULES: { intent: Intent; cause: RootCause; words: string[] }[] = [
  { intent: "subscription_manage", cause: "inventory_stockout", words: ["subscription", "daily milk", "milk delivery", "roz aana", "skip ho rah"] },
  { intent: "offer_not_applied", cause: "app_bug", words: ["coupon", "monsoon30", "promo code", "discount lag", "offer lag", "apply nahi ho", "code apply"] },
  { intent: "payment_failed", cause: "payment_gateway", words: ["kat gaye hain", "kat gaye lekin", "debited", "deduct ho gaya", "payment fail", "order place nahi hua"] },
  { intent: "quality_complaint", cause: "supplier_quality", words: ["keede", "insect", "ajeeb aa rahi", "expiry", "expired", "stale", "badboo", "health ka matter"] },
  { intent: "damaged_or_spoiled", cause: "logistics_3pl", words: ["toota hua", "leak ho", "pighla", "melted", "damaged", "broken", "spoiled", "bah gaya"] },
  { intent: "wrong_or_missing_item", cause: "warehouse_pick_error", words: ["missing", "nahi mila", "hai hi nahi", "invoice pe likha", "wrong item", "galat item", "short bheja"] },
  { intent: "return_pickup", cause: "logistics_3pl", words: ["pickup", "lene nahi aaya", "uthane nahi aaya", "return schedule"] },
  { intent: "cancellation", cause: "policy_friction", words: ["cancel karna", "cancel kar", "radd", "order nahi chahiye"] },
  { intent: "address_change", cause: "customer_expectation", words: ["address change", "address badal", "pata badal", "shift ho gaya", "naye ghar"] },
  { intent: "refund_status", cause: "policy_friction", words: ["refund abhi tak", "refund nahi aaya", "refund kab", "paise wapas nahi", "money back", "chasing a refund"] },
  { intent: "delivery_delay", cause: "logistics_3pl", words: ["din late", "late hai", "der ho gay", "abhi tak nahi aaya", "delay", "promised date se", "past the promised"] },
  { intent: "order_tracking", cause: "customer_expectation", words: ["kahan tak", "ka status", "track", "kab tak aayega", "where is my order"] },
  { intent: "feedback_positive", cause: "customer_expectation", words: ["feedback", "satisfied", "badhiya", "achha laga", "5 doonga"] },
];

const NEG = ["pareshan", "gussa", "bakwas", "bahut bura", "teesri baar", "har baar", "kharab", "galat", "nahi chahiye", "consumer forum", "senior", "shikayat", "worst", "ridiculous", "unacceptable", "frustrated", "angry"];
const POS = ["thank", "dhanyavaad", "shukriya", "badhiya", "achha", "perfect", "great", "theek hai", "helpful", "satisfied"];

function score(text: string) {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of NEG) if (t.includes(w)) s -= 1;
  for (const w of POS) if (t.includes(w)) s += 1;
  if (/[!?]{2,}/.test(text)) s -= 0.5;
  return Math.max(-1, Math.min(1, s / 2.5));
}

export interface LocalExtractInput {
  transcript: Turn[];
  city?: string | null;
  orderId?: string | null;
  orderValue?: number | null;
}

export type ExtractedFields = Pick<
  CallInsight,
  | "summary" | "primaryIntent" | "secondaryIntents" | "rootCause" | "rootCauseNote"
  | "sentimentStart" | "sentimentEnd" | "csatPredicted" | "resolved" | "resolution"
  | "contained" | "handoffReason" | "escalationRisk" | "churnRisk" | "repeatCaller"
  | "refundRequested" | "refundAmountInr" | "productMentions" | "competitorMentions"
  | "policyFriction" | "agentCompliance" | "quotes" | "productSignal" | "tags" | "nextBestAction"
>;

export function extractLocally(input: LocalExtractInput): ExtractedFields {
  const turns = input.transcript;
  const cust = turns.filter((t) => t.role === "customer");
  const agent = turns.filter((t) => t.role === "agent");
  const custText = cust.map((t) => t.text).join(" ").toLowerCase();
  const agentText = agent.map((t) => t.text).join(" ").toLowerCase();
  const all = `${custText} ${agentText}`;

  // Intent: first matching rule wins, and the rules are ordered most-specific
  // first so "damaged" beats the "delay" mention that usually accompanies it.
  let matched = INTENT_RULES.find((r) => has(custText, ...r.words));
  if (!matched) matched = INTENT_RULES.find((r) => has(all, ...r.words));
  const primaryIntent: Intent = matched?.intent ?? "order_tracking";
  let rootCause: RootCause = matched?.cause ?? "customer_expectation";

  if (primaryIntent === "damaged_or_spoiled" && has(all, "pighla", "melted", "ice", "cold", "insulated")) {
    rootCause = "cold_chain";
  }
  if (primaryIntent === "offer_not_applied" && has(all, "exclusion", "category", "terms", "t&c")) {
    rootCause = "customer_expectation";
  }

  const secondaryIntents = INTENT_RULES.filter((r) => r.intent !== primaryIntent && has(custText, ...r.words))
    .slice(0, 2)
    .map((r) => r.intent);

  const sentimentStart = cust.length ? score(cust[0].text) : 0;
  const sentimentEnd = cust.length ? score(cust[cust.length - 1].text) : 0;

  const transferred = has(agentText, "transfer", "senior specialist", "line pe rahiye");
  const contained = !transferred;

  let resolution: Resolution = "info_provided";
  if (has(agentText, "refund", "initiate kar")) resolution = "refund_initiated";
  if (has(agentText, "replacement", "redelivery")) resolution = "replacement_scheduled";
  if (has(agentText, "pickup schedule", "dobara schedule")) resolution = "pickup_scheduled";
  if (has(agentText, "ticket raise", "follow up karenge")) resolution = "callback_promised";
  if (transferred) resolution = "escalated_human";

  const repeatCaller = has(custText, "teesri baar", "dusri baar", "pichli baar", "har baar", "second time", "again");
  const refundRequested = has(all, "refund", "paise wapas", "money back");
  const amountMatch = all.match(/(\d{2,6})\s*(rupaye|rupees|rs)/);
  const refundAmountInr = refundRequested ? Number(amountMatch?.[1] ?? input.orderValue ?? 0) : 0;

  // Matched case-insensitively but reported in the brand's real casing —
  // "Quickcart" in a dashboard looks like a different company.
  const COMPETITORS = ["QuickCart", "Zipp Basket", "DailyBazaar", "Nuvo Fresh"];
  const competitorMentions = COMPETITORS.filter((c) => all.includes(c.toLowerCase()));

  const escalationRisk = Math.min(
    1,
    Math.max(0, (transferred ? 0.5 : 0) + (repeatCaller ? 0.28 : 0) + Math.max(0, -sentimentEnd) * 0.5 + 0.1),
  );
  const churnRisk = Math.min(1, Math.max(0, (competitorMentions.length ? 0.4 : 0) + Math.max(0, -sentimentEnd) * 0.4 + 0.1));

  const resolved = !transferred && resolution !== "info_provided" ? true : !transferred && sentimentEnd >= 0;
  const csatPredicted = Math.max(
    1,
    Math.min(5, Math.round(3 + sentimentEnd * 1.6 + (resolved ? 0.6 : -0.6) - (transferred ? 1 : 0))),
  );

  // Pick the most negative turn and the most substantial one, and label each
  // for the reason it was picked rather than stamping both the same way.
  const ranked = [...cust].filter((t) => t.text.length > 24);
  const mostNegative = ranked.reduce<Turn | null>((best, t) => (!best || score(t.text) < score(best.text) ? t : best), null);
  const longest = ranked.reduce<Turn | null>((best, t) => (!best || t.text.length > best.text.length ? t : best), null);

  const quotes: { text: string; tMs: number; tag: string }[] = [];
  if (mostNegative && score(mostNegative.text) < -0.15) {
    quotes.push({ text: mostNegative.text, tMs: mostNegative.tMs, tag: "Most negative turn" });
  }
  if (longest && !quotes.some((q) => q.text === longest.text)) {
    quotes.push({ text: longest.text, tMs: longest.tMs, tag: "Fullest statement of the problem" });
  }

  const policyFriction: string[] = [];
  if (has(agentText, "working days")) policyFriction.push("Multi-day refund settlement window quoted to the customer");
  if (has(agentText, "refuse-on-delivery")) policyFriction.push("Post-dispatch cancellation is not self-serve");

  return {
    summary: `${primaryIntent.replace(/_/g, " ")} raised by the customer; agent ${
      transferred ? "transferred the call to a human" : `handled it and ${resolution.replace(/_/g, " ")}`
    }.`,
    primaryIntent,
    secondaryIntents,
    rootCause,
    rootCauseNote: "Derived by keyword rules without a model — treat as indicative only.",
    sentimentStart: Number(sentimentStart.toFixed(2)),
    sentimentEnd: Number(sentimentEnd.toFixed(2)),
    csatPredicted,
    resolved,
    resolution,
    contained,
    handoffReason: transferred ? "Agent transferred the call" : null,
    escalationRisk: Number(escalationRisk.toFixed(2)),
    churnRisk: Number(churnRisk.toFixed(2)),
    repeatCaller,
    refundRequested,
    refundAmountInr,
    productMentions: [],
    competitorMentions,
    policyFriction,
    agentCompliance: {
      greeting: /namaste|hello|good (morning|evening|afternoon)/i.test(agent[0]?.text ?? ""),
      identityVerified: input.orderId ? agentText.includes(input.orderId.toLowerCase()) : /order|account/.test(agentText),
      empathyShown: has(agentText, "sorry", "khed", "samajh sakti", "bura laga", "apolog"),
      correctPolicyQuoted: has(agentText, "working days", "ghante", "hours", "policy"),
      closedTheLoop: has(agent[agent.length - 1]?.text.toLowerCase() ?? "", "thank", "dhanyavaad", "day"),
    },
    quotes,
    // The rules engine deliberately never claims a product signal. Deciding
    // that one customer's complaint generalises is a judgement call, and a
    // keyword match is not one.
    productSignal: null,
    tags: [primaryIntent, rootCause].slice(0, 3),
    nextBestAction: `Review the ${ROOT_CAUSE_OWNER[rootCause]} queue for this pattern.`,
  };
}
