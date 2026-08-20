import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { EXTRACTION_SCHEMA, SYSTEM_PROMPT, buildUserMessage, DEFAULT_MODEL, MODEL_RATES } from "@/lib/prompt";
import { extractLocally } from "@/lib/extract-local";
import { modelChain, runWithFallback } from "@/lib/model-chain";
import type { Turn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  transcript: Turn[];
  city?: string | null;
  orderId?: string | null;
  orderValue?: number | null;
  durationSec?: number;
  /** Forces the rules engine even when a key is set. Used by the eval harness
   *  to score the model against the baseline over the identical input. */
  forceLocal?: boolean;
}

/**
 * One call in, one structured record out.
 *
 * The API key never reaches the browser — this route exists so the deployed
 * page can run a real extraction without shipping a credential to every
 * visitor. With no key configured it falls through to the rules engine and
 * says so in the response, rather than failing.
 *
 * Output is constrained with Gemini's responseJsonSchema, so the model is
 * decoding against the schema rather than being asked nicely to produce JSON.
 * There is no parse-the-prose-with-a-regex step anywhere in this project.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.transcript) || body.transcript.length === 0) {
    return NextResponse.json({ error: "transcript must be a non-empty array of turns." }, { status: 400 });
  }
  // A live call is at most a few hundred turns; anything larger is not a call.
  if (body.transcript.length > 400) {
    return NextResponse.json({ error: "Transcript too long for a single call." }, { status: 413 });
  }

  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || body.forceLocal) {
    return NextResponse.json({
      insight: extractLocally(body),
      extractedBy: "local-fallback",
      extractionMs: Date.now() - started,
      extractionCostUsd: 0,
      note: body.forceLocal
        ? "Rules engine requested explicitly."
        : "No GEMINI_API_KEY is configured, so this ran on the local rules engine. Set the key to run the real extraction.",
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const { value: response, model, skipped } = await runWithFallback(modelChain(), (m) =>
      ai.models.generateContent({
        model: m,
        contents: buildUserMessage(body),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_SCHEMA,
          temperature: 0.2,
          // Generous, because the Flash models spend part of this budget on
          // internal reasoning before the JSON. Too low and the response comes
          // back empty rather than truncated, which is a confusing failure.
          maxOutputTokens: 8192,
        },
      }),
    );

    const text = response.text;
    if (!text) {
      throw new Error(
        `The model returned no text (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}). This usually means maxOutputTokens was exhausted.`,
      );
    }

    const raw = JSON.parse(text) as Record<string, unknown>;

    const usage = response.usageMetadata;
    const inTok = usage?.promptTokenCount ?? 0;
    // Reasoning tokens are billed as output, so they belong in the cost figure.
    const outTok = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const rates = MODEL_RATES[model];
    const cost = rates ? (inTok / 1e6) * rates.in + (outTok / 1e6) * rates.out : 0;

    // Attach timestamps to the quotes by matching them back to the transcript.
    // The model returns the text it quoted, not an offset, so the offset is
    // recovered here rather than asking it to count milliseconds.
    const quotes = Array.isArray(raw.quotes)
      ? (raw.quotes as { text: string; tag: string }[]).map((q) => {
          const hit =
            body.transcript.find((t) => t.text.trim() === q.text.trim()) ??
            body.transcript.find((t) => t.text.includes(q.text.slice(0, 40)));
          return { ...q, tMs: hit?.tMs ?? 0 };
        })
      : [];

    return NextResponse.json({
      insight: { ...raw, quotes },
      extractedBy: "llm",
      model,
      extractionMs: Date.now() - started,
      extractionCostUsd: Number(cost.toFixed(6)),
      freeTier: true,
      usage: { inputTokens: inTok, outputTokens: outTok },
      // Surfaced so a degraded answer never silently passes as the primary one.
      note: skipped.length
        ? `${skipped.map((s) => `${s.model} was ${s.reason}`).join("; ")} — served by ${model} instead.`
        : undefined,
    });
  } catch (err) {
    // A failed extraction should degrade to the rules engine rather than lose
    // the call. The reason is surfaced so it is visible, not swallowed.
    const message = err instanceof Error ? err.message : "Unknown error";

    return NextResponse.json({
      insight: extractLocally(body),
      extractedBy: "local-fallback",
      extractionMs: Date.now() - started,
      extractionCostUsd: 0,
      note: `Model extraction failed (${message}). Fell back to the local rules engine.`,
    });
  }
}
