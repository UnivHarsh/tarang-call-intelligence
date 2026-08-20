/**
 * The voice agent configuration.
 *
 * This is passed inline when starting a web call, which means the whole live
 * demo needs exactly one environment variable (the public key) rather than a
 * public key plus a dashboard-created assistant ID. The config lives in the
 * repo so it is reviewable and versioned like everything else.
 *
 * If you would rather create the assistant in the Vapi dashboard, set
 * NEXT_PUBLIC_VAPI_ASSISTANT_ID and this object is ignored.
 */

import { AGENT_GREETING, AGENT_SYSTEM_PROMPT } from "./voice-agent";

// Re-exported so the "How it works" page can render the same prompt the live
// browser session uses. One prompt, two transports.
export const FIRST_MESSAGE = AGENT_GREETING;
export const ASSISTANT_SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

/**
 * Shape matches Vapi's inline assistant config. Kept loosely typed because the
 * SDK's generated DTO is deep and we only set a documented subset of it.
 */
export const ASSISTANT_CONFIG = {
  name: "Maya — Kartly support",
  firstMessage: FIRST_MESSAGE,
  // Hindi/English code-switching is the whole point of this demo, so the
  // transcriber has to be multilingual rather than en-IN.
  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "multi",
  },
  // Vapi bills this from your Vapi credits by default; you can also connect
  // your own Google AI Studio key under Integrations in their dashboard.
  // If Vapi ever rejects this model string, any ID from their Gemini provider
  // page is a drop-in replacement — nothing else here depends on it.
  model: {
    provider: "google",
    model: "gemini-2.5-flash",
    temperature: 0.4,
    messages: [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }],
  },
  voice: {
    provider: "vapi",
    voiceId: "Neha",
  },
  // A support call that has gone quiet for 20s is over.
  silenceTimeoutSeconds: 20,
  maxDurationSeconds: 300,
  endCallMessage: "Kartly choose karne ke liye dhanyavaad. Aapka din shubh ho.",
  endCallPhrases: ["bye", "goodbye", "alvida", "dhanyavaad bye"],
} as const;

export const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
export const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";
export const VAPI_CONFIGURED = Boolean(VAPI_PUBLIC_KEY);
