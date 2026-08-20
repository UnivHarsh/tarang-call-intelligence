import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import type { CallInsight } from "@/lib/types";
import { INTENT_LABELS, ROOT_CAUSE_LABELS } from "@/lib/types";
import {
  emergingIssues, recedingIssues, weekBuckets, distribution, clusterSignals,
  metricCsat, metricContainment, shortDate, inr,
} from "@/lib/analytics";
import { DEFAULT_MODEL, MODEL_RATES } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

let cache: CallInsight[] | null = null;

async function loadCorpus(): Promise<CallInsight[]> {
  if (cache) return cache;
  const p = path.join(process.cwd(), "public", "data", "index.json");
  cache = JSON.parse(await fs.readFile(p, "utf8")) as CallInsight[];
  return cache;
}

/**
 * Builds the briefing the model reasons over.
 *
 * The whole corpus is far too large to send, and sending raw transcripts would
 * be the wrong shape anyway — the questions people ask are aggregate questions.
 * So the aggregates are computed in code (deterministically, and identically to
 * what the dashboard renders) and the model is given those plus a retrieved
 * slice of individual calls for evidence. The model does judgement and prose;
 * it never does arithmetic on 900 records.
 */
function buildBriefing(calls: CallInsight[]) {
  const buckets = weekBuckets(calls);
  const weekly = buckets.map((b) => ({
    week: shortDate(b.start),
    calls: b.calls.length,
    csat: Number(metricCsat(b.calls).toFixed(2)),
    contained: Number(metricContainment(b.calls).toFixed(1)),
  }));

  const worse = emergingIssues(calls).map((e) => ({
    segment: e.label,
    dimension: e.dimension,
    owner: e.owner,
    beforePct: Number(e.baseRate.toFixed(1)),
    afterPct: Number(e.recentRate.toFixed(1)),
    z: Number(e.z.toFixed(1)),
    recentCalls: e.recentCount,
    exampleCallIds: e.sampleCallIds,
  }));

  const better = recedingIssues(calls).map((e) => ({
    segment: e.label,
    beforePct: Number(e.baseRate.toFixed(1)),
    afterPct: Number(e.recentRate.toFixed(1)),
    z: Number(e.z.toFixed(1)),
  }));

  const signals = clusterSignals(calls).map((s) => ({
    title: s.title,
    owner: s.owner,
    severity: s.severity,
    calls: s.count,
    lastTwoWeeks: s.weeklyCounts.slice(-2).reduce((a, b) => a + b, 0),
    refundExposureInr: s.refundExposure,
    exampleCallIds: s.callIds.slice(0, 4),
  }));

  const cityRows = [...new Set(calls.map((c) => c.customer.city))].map((city) => {
    const cs = calls.filter((c) => c.customer.city === city);
    return {
      city,
      calls: cs.length,
      csat: Number(metricCsat(cs).toFixed(2)),
      contained: Number(metricContainment(cs).toFixed(1)),
    };
  });

  return {
    corpus: {
      calls: calls.length,
      window: `${shortDate(buckets[0].start)} to ${shortDate(buckets[buckets.length - 1].end)} 2026`,
      totalRefundDiscussed: inr(calls.reduce((a, c) => a + c.refundAmountInr, 0)),
    },
    weekly,
    intents: distribution(calls, (c) => c.primaryIntent, INTENT_LABELS, 13).map((d) => ({
      label: d.label, calls: d.count, share: `${(d.share * 100).toFixed(1)}%`,
    })),
    rootCauses: distribution(calls, (c) => c.rootCause, ROOT_CAUSE_LABELS, 10).map((d) => ({
      label: d.label, calls: d.count, share: `${(d.share * 100).toFixed(1)}%`,
    })),
    gettingWorse: worse,
    gettingBetter: better,
    productSignals: signals,
    byCity: cityRows,
  };
}

/** Cheap lexical retrieval over the call summaries, for evidence. */
function retrieve(calls: CallInsight[], question: string, k = 14) {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (!terms.length) return calls.slice(-k);

  return calls
    .map((c) => {
      const hay = `${c.summary} ${c.rootCauseNote} ${c.primaryIntent} ${c.rootCause} ${c.customer.city} ${c.tags.join(" ")} ${c.nextBestAction} ${c.productSignal?.title ?? ""}`.toLowerCase();
      let s = 0;
      for (const t of terms) if (hay.includes(t)) s += 1;
      // Break ties toward recency: a stale example is a worse citation.
      return { c, s: s + Date.parse(c.startedAt) / 1e16 };
    })
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => ({
      id: x.c.id,
      date: x.c.startedAt.slice(0, 10),
      city: x.c.customer.city,
      intent: x.c.primaryIntent,
      rootCause: x.c.rootCause,
      csat: x.c.csatPredicted,
      summary: x.c.summary,
      quote: x.c.quotes[0]?.text ?? null,
      nextBestAction: x.c.nextBestAction,
    }));
}

const SYSTEM = `You are a support-operations analyst for Kartly, a D2C grocery retailer in India. You answer questions about a corpus of analysed customer support calls.

You are given two things: a briefing of pre-computed aggregates, and a retrieved set of individual call records relevant to the question. Both are trustworthy. The aggregates were computed in code from the full corpus — use their numbers exactly as given and never recompute or estimate them.

How to answer:

- Lead with the answer. No preamble, no restating the question.
- Cite specific calls by id in square brackets, like [c_0412], when you make a claim that rests on individual calls. Only cite ids that appear in the material you were given.
- Give the number when there is one. "Cold chain went from 8.4% to 15.9% of calls" beats "cold chain complaints rose sharply".
- If the material does not answer the question, say so plainly and say what would. Do not fill the gap with a plausible guess.
- Distinguish what the data shows from what you infer. An inference is fine when it is labelled as one.
- Be brief. Three short paragraphs at most, and use a short list when the answer is genuinely a list.
- Write plainly. No bold headers, no bullet-point theatre, no "Great question".`;

export async function POST(req: NextRequest) {
  let question = "";
  try {
    ({ question } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (typeof question !== "string" || question.trim().length < 3) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  const calls = await loadCorpus();
  const briefing = buildBriefing(calls);
  const evidence = retrieve(calls, question);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      answer: demoAnswer(question, briefing),
      citations: evidence.slice(0, 3).map((e) => e.id),
      mode: "demo",
      note: "No GEMINI_API_KEY is configured. This answer was assembled from the same pre-computed aggregates the model would have been given, without the model.",
    });
  }

  const model = process.env.TARANG_MODEL || DEFAULT_MODEL;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: `Briefing (pre-computed from all ${calls.length} calls):\n${JSON.stringify(briefing, null, 1)}\n\nRetrieved calls relevant to the question:\n${JSON.stringify(evidence, null, 1)}\n\nQuestion: ${question}`,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const text = (response.text ?? "").trim();
    if (!text) {
      throw new Error(`The model returned no text (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}).`);
    }

    const cited = [...new Set(text.match(/c_\d{4}/g) ?? [])];
    const usage = response.usageMetadata;
    const inTok = usage?.promptTokenCount ?? 0;
    // Reasoning tokens bill as output on the Flash models.
    const outTok = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const rates = MODEL_RATES[model];
    const cost = rates ? (inTok / 1e6) * rates.in + (outTok / 1e6) * rates.out : 0;

    return NextResponse.json({
      answer: text,
      citations: cited,
      mode: "llm",
      model,
      costUsd: Number(cost.toFixed(6)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({
      answer: demoAnswer(question, briefing),
      citations: evidence.slice(0, 3).map((e) => e.id),
      mode: "demo",
      note: `The model call failed (${message}). This answer came from the pre-computed aggregates instead.`,
    });
  }
}

type Briefing = ReturnType<typeof buildBriefing>;

/**
 * Keyless mode. Rather than refusing, this answers from the same aggregates the
 * model would have received — so the page demonstrates the retrieval half of
 * the system truthfully, and is clearly labelled as not being the model.
 */
function demoAnswer(question: string, b: Briefing): string {
  const q = question.toLowerCase();
  const lines: string[] = [];

  if (/worse|rising|emerging|problem|wrong|broken|spike/.test(q) || !q.trim()) {
    if (b.gettingWorse.length) {
      const n = b.gettingWorse.length;
      lines.push(
        `${n} segment${n === 1 ? "" : "s"} cleared the significance bar in the last 14 days. ${b.gettingWorse
          .map((w) => `${w.segment} went from ${w.beforePct}% to ${w.afterPct}% of all calls (z=${w.z}, ${w.recentCalls} calls, owned by ${w.owner})`)
          .join(". ")}.`,
      );
    } else {
      lines.push("Nothing cleared the significance bar for a rising trend in the last 14 days.");
    }
  }

  if (/better|improv|fixed|recover|working/.test(q) && b.gettingBetter.length) {
    lines.push(
      `Receding: ${b.gettingBetter.map((w) => `${w.segment} fell from ${w.beforePct}% to ${w.afterPct}% (z=${w.z})`).join(", ")}.`,
    );
  }

  if (/city|cities|region|where|mumbai|delhi|bengaluru|hyderabad/.test(q)) {
    const worst = [...b.byCity].sort((a, c) => a.csat - c.csat).slice(0, 3);
    lines.push(
      `By city, the lowest predicted CSAT is ${worst.map((c) => `${c.city} (${c.csat} across ${c.calls} calls)`).join(", ")}.`,
    );
  }

  if (/signal|bug|product|engineering|ship|fix/.test(q) && b.productSignals.length) {
    lines.push(
      `Open product signals: ${b.productSignals
        .slice(0, 3)
        .map((s) => `${s.title} — ${s.calls} calls, ${s.lastTwoWeeks} in the last fortnight, owner ${s.owner}`)
        .join("; ")}.`,
    );
  }

  if (/csat|satisfaction|happy|score/.test(q)) {
    const first = b.weekly[0];
    const last = b.weekly[b.weekly.length - 1];
    lines.push(
      `Predicted CSAT moved from ${first.csat} in the week of ${first.week} to ${last.csat} in the week of ${last.week}. Containment over the same period went from ${first.contained}% to ${last.contained}%.`,
    );
  }

  if (/refund|money|cost|₹|rupee/.test(q)) {
    lines.push(`${b.corpus.totalRefundDiscussed} of refund value is discussed across the ${b.corpus.calls} calls in the window.`);
  }

  if (!lines.length) {
    lines.push(
      `Without a model key this endpoint can only report the pre-computed aggregates. For this corpus: ${b.corpus.calls} calls over ${b.corpus.window}, top intent ${b.intents[0].label} at ${b.intents[0].share}, top root cause ${b.rootCauses[0].label} at ${b.rootCauses[0].share}.`,
    );
  }

  return lines.join("\n\n");
}
