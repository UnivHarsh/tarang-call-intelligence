import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_SCHEMA, EXTRACTION_TOOL_NAME, SYSTEM_PROMPT, buildUserMessage, DEFAULT_MODEL, MODEL_RATES } from "@/lib/prompt";
import { extractLocally } from "@/lib/extract-local";
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
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || body.forceLocal) {
    return NextResponse.json({
      insight: extractLocally(body),
      extractedBy: "local-fallback",
      extractionMs: Date.now() - started,
      extractionCostUsd: 0,
      note: body.forceLocal
        ? "Rules engine requested explicitly."
        : "No ANTHROPIC_API_KEY is configured, so this ran on the local rules engine. Set the key to run the real extraction.",
    });
  }

  const model = process.env.TARANG_MODEL || DEFAULT_MODEL;

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: EXTRACTION_TOOL_NAME,
          description: "Record the structured insight for exactly one support call.",
          strict: true,
          input_schema: EXTRACTION_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
      messages: [{ role: "user", content: buildUserMessage(body) }],
    });

    const block = response.content.find((b) => b.type === "tool_use" && b.name === EXTRACTION_TOOL_NAME);
    if (!block || block.type !== "tool_use") {
      return NextResponse.json(
        { error: "The model did not return a structured record.", stopReason: response.stop_reason },
        { status: 502 },
      );
    }

    const rates = MODEL_RATES[model];
    const cost = rates
      ? (response.usage.input_tokens / 1e6) * rates.in + (response.usage.output_tokens / 1e6) * rates.out
      : 0;

    // Attach timestamps to the quotes by matching them back to the transcript.
    // The model returns the text it quoted, not an offset, so the offset is
    // recovered here rather than asking it to count milliseconds.
    const raw = block.input as Record<string, unknown>;
    const quotes = Array.isArray(raw.quotes)
      ? (raw.quotes as { text: string; tag: string }[]).map((q) => {
          const hit = body.transcript.find((t) => t.text.trim() === q.text.trim())
            ?? body.transcript.find((t) => t.text.includes(q.text.slice(0, 40)));
          return { ...q, tMs: hit?.tMs ?? 0 };
        })
      : [];

    return NextResponse.json({
      insight: { ...raw, quotes },
      extractedBy: "llm",
      model,
      extractionMs: Date.now() - started,
      extractionCostUsd: Number(cost.toFixed(6)),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    // A failed extraction should degrade to the rules engine rather than lose
    // the call. The reason is surfaced so it is visible, not swallowed.
    const message =
      err instanceof Anthropic.APIError
        ? `${err.status ?? "API"}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";

    return NextResponse.json({
      insight: extractLocally(body),
      extractedBy: "local-fallback",
      extractionMs: Date.now() - started,
      extractionCostUsd: 0,
      note: `Model extraction failed (${message}). Fell back to the local rules engine.`,
    });
  }
}
