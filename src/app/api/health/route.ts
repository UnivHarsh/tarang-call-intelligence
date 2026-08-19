import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/prompt";
import { VAPI_CONFIGURED } from "@/lib/vapi-assistant";

export const runtime = "nodejs";

/**
 * Reports which capabilities this deployment actually has, without ever
 * revealing a key. The eval harness reads it to refuse to run a meaningless
 * comparison, and it is the fastest way to answer "why is the demo in
 * fallback mode" on a deployed instance.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasVapiKey: VAPI_CONFIGURED,
    model: process.env.TARANG_MODEL || DEFAULT_MODEL,
  });
}
