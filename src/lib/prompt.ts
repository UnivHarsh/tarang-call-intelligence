import { INTENTS, RESOLUTIONS, ROOT_CAUSES } from "./types";

/**
 * The extraction contract.
 *
 * This file is deliberately the only place the schema and the prompt live, and
 * the "How it works" page renders it straight from here — if the prompt on the
 * page and the prompt in production could drift, the page would be marketing
 * rather than documentation.
 */

export const EXTRACTION_TOOL_NAME = "record_call_insight";

export const EXTRACTION_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description:
        "Two sentences maximum. What the customer wanted and what actually happened. Written for someone who will never listen to the call.",
    },
    primaryIntent: {
      type: "string",
      enum: [...INTENTS],
      description: "The single reason this person picked up the phone. If several apply, choose what they led with.",
    },
    secondaryIntents: {
      type: "array",
      items: { type: "string", enum: [...INTENTS] },
      description: "Other intents genuinely raised on the call. Empty array if there were none — do not pad this.",
    },
    rootCause: {
      type: "string",
      enum: [...ROOT_CAUSES],
      description:
        "Which team owns the fix. This is NOT the intent restated. A customer calling about a delayed delivery may have a logistics_3pl root cause, or a customer_expectation one if the delivery was actually on time and the promise was wrong.",
    },
    rootCauseNote: {
      type: "string",
      description: "One sentence naming the specific failure, with the concrete detail from the call that evidences it.",
    },
    sentimentStart: {
      type: "number",
      description: "Customer sentiment in their first substantive turn, -1 to 1.",
    },
    sentimentEnd: {
      type: "number",
      description: "Customer sentiment in their last substantive turn, -1 to 1. The delta matters more than either value.",
    },
    csatPredicted: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description:
        "What this customer would score the interaction, 1-5. Judge the handling, not the underlying problem: a well-handled bad situation can still be a 4.",
    },
    resolved: { type: "boolean", description: "Did the customer leave with their problem actually addressed?" },
    resolution: { type: "string", enum: [...RESOLUTIONS] },
    contained: {
      type: "boolean",
      description: "True if the agent finished the call without transferring to a human.",
    },
    handoffReason: {
      type: ["string", "null"],
      description: "If not contained, why the handoff happened. Null otherwise.",
    },
    escalationRisk: {
      type: "number",
      description:
        "0 to 1. How close this customer is to demanding a supervisor, disputing the charge, or complaining publicly. Repeat contact and explicit threats push this up sharply.",
    },
    churnRisk: {
      type: "number",
      description:
        "0 to 1. Likelihood this customer stops ordering. A calm customer who mentions a competitor by name is higher risk than an angry one who does not.",
    },
    repeatCaller: {
      type: "boolean",
      description: "True if the customer says or implies they have contacted us about this before.",
    },
    refundRequested: { type: "boolean" },
    refundAmountInr: {
      type: "number",
      description: "Rupee amount refunded or requested. 0 if none was discussed.",
    },
    productMentions: {
      type: "array",
      items: { type: "string" },
      description: "Specific products named by either party.",
    },
    competitorMentions: {
      type: "array",
      items: { type: "string" },
      description: "Competing services the customer names.",
    },
    policyFriction: {
      type: "array",
      items: { type: "string" },
      description:
        "Policies that made this call harder than it needed to be, phrased as the rule rather than the incident. Empty if none.",
    },
    agentCompliance: {
      type: "object",
      additionalProperties: false,
      properties: {
        greeting: { type: "boolean" },
        identityVerified: { type: "boolean", description: "Did the agent confirm the order or account before acting?" },
        empathyShown: { type: "boolean", description: "Genuine acknowledgement, not a scripted apology token." },
        correctPolicyQuoted: { type: "boolean", description: "Were the timelines and rules stated accurately?" },
        closedTheLoop: { type: "boolean", description: "Did the agent state a concrete next step and close properly?" },
      },
      required: ["greeting", "identityVerified", "empathyShown", "correctPolicyQuoted", "closedTheLoop"],
    },
    quotes: {
      type: "array",
      description:
        "One to three verbatim customer lines that a human reviewer would highlight. Quote exactly, including code-mixed Hindi and English. Do not translate or clean them up.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          tag: { type: "string", description: "Three to five words on why this line matters." },
        },
        required: ["text", "tag"],
      },
    },
    productSignal: {
      type: ["object", "null"],
      additionalProperties: false,
      description:
        "Only when the call reveals something a product or ops team could act on that is bigger than this one customer. Null is the correct and common answer.",
      properties: {
        title: { type: "string", description: "The problem, stated as a fact about the system rather than the customer." },
        evidence: { type: "string", description: "What in this specific call supports it." },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        owner: { type: "string" },
      },
      required: ["title", "evidence", "severity", "owner"],
    },
    tags: { type: "array", items: { type: "string" }, description: "Two to four lowercase snake_case tags." },
    nextBestAction: {
      type: "string",
      description:
        "One sentence. The systemic change that would stop this call from happening again — not what the agent should have said.",
    },
  },
  required: [
    "summary", "primaryIntent", "secondaryIntents", "rootCause", "rootCauseNote",
    "sentimentStart", "sentimentEnd", "csatPredicted", "resolved", "resolution",
    "contained", "handoffReason", "escalationRisk", "churnRisk", "repeatCaller",
    "refundRequested", "refundAmountInr", "productMentions", "competitorMentions",
    "policyFriction", "agentCompliance", "quotes", "productSignal", "tags", "nextBestAction",
  ],
};

export const SYSTEM_PROMPT = `You are an analyst reading customer support calls for Kartly, a direct-to-consumer grocery and household retailer in India. You read one call and return one structured record.

The calls are code-mixed. Most are Hinglish — Hindi grammar with English nouns, written in Latin script — and some are English or mostly Hindi. Read them as a fluent speaker would. Do not translate, do not normalise the spelling, and do not treat code-mixing as noise.

What the output is for: an ops lead reads a hundred of these a week and decides what to fix. Every field is a decision input, not a description of the audio.

How to judge:

1. Intent is what the customer asked for. Root cause is what actually went wrong, and therefore which team owns it. Keeping these apart is the single most important thing you do here. "Where is my order" is order_tracking; whether the root cause is logistics_3pl or customer_expectation depends entirely on whether the order was actually late.

2. Prefer the specific over the safe. customer_expectation is the correct answer when the promise was wrong, and a lazy one when you simply cannot tell. If the call genuinely does not say, choose the cause the evidence best supports and let rootCauseNote carry the uncertainty.

3. csatPredicted judges the handling, not the underlying problem. A customer whose order was ruined but who was believed immediately and refunded without argument may well leave a 4.

4. escalationRisk and churnRisk are different things. Someone shouting who then accepts a fix is high escalation, low churn. Someone perfectly polite who mentions a competitor by name and asks how to close their account is the reverse.

5. productSignal is not a summary field. Fill it only when the call reveals something about the system that would still be true for other customers — a coupon that fails on one platform, a batch with a defect, a status that is silently wrong. A single person's bad day is not a product signal. Null is the common answer and you should return it without hesitation.

6. nextBestAction addresses the system, not the agent. "Agent should apologise sooner" is not useful. "Send the refund reference by SMS automatically so this call never happens" is.

7. Quote verbatim. The quotes are read by people deciding whether to trust the rest of the record, so a cleaned-up or translated quote destroys their entire purpose.

Return your answer by calling the ${EXTRACTION_TOOL_NAME} tool exactly once.`;

/** Formats a transcript into the shape the prompt expects. */
export function renderTranscript(turns: { role: string; text: string; tMs: number }[]) {
  return turns
    .map((t) => {
      const s = Math.floor(t.tMs / 1000);
      const stamp = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      return `[${stamp}] ${t.role === "agent" ? "AGENT" : "CUSTOMER"}: ${t.text}`;
    })
    .join("\n");
}

export function buildUserMessage(opts: {
  transcript: { role: string; text: string; tMs: number }[];
  orderId?: string | null;
  orderValue?: number | null;
  city?: string | null;
  durationSec?: number;
}) {
  const context: string[] = [];
  if (opts.city) context.push(`Customer city: ${opts.city}`);
  if (opts.orderId) context.push(`Order on file: ${opts.orderId}`);
  if (opts.orderValue) context.push(`Order value: ₹${opts.orderValue}`);
  if (opts.durationSec) context.push(`Call duration: ${opts.durationSec}s`);

  return `${context.length ? `Call metadata:\n${context.join("\n")}\n\n` : ""}Transcript:\n${renderTranscript(opts.transcript)}`;
}

/**
 * Per-call cost of the extraction pass, for the economics table.
 * Rates are USD per million tokens, first-party Anthropic API.
 */
export const MODEL_RATES: Record<string, { label: string; in: number; out: number; note?: string }> = {
  "claude-opus-5": { label: "Claude Opus 5", in: 5, out: 25 },
  "claude-sonnet-5": { label: "Claude Sonnet 5", in: 3, out: 15, note: "intro pricing $2 / $10 through 31 Aug 2026" },
  "claude-haiku-4-5": { label: "Claude Haiku 4.5", in: 1, out: 5 },
};

export const DEFAULT_MODEL = "claude-opus-5";
