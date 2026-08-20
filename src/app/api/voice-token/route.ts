import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";
import { LIVE_MODEL, LIVE_VOICE, AGENT_SYSTEM_PROMPT, AGENT_GREETING } from "@/lib/voice-agent";

export const runtime = "nodejs";

/**
 * Mints a short-lived token so the browser can open a Live API socket without
 * ever seeing the API key.
 *
 * The Live API is a direct browser-to-Google WebSocket — there is no way to
 * proxy it through here without rebuilding the whole audio path server-side.
 * Ephemeral tokens exist for exactly this: single-use, expiring in minutes, and
 * locked to one model with one config, so a leaked token buys someone one short
 * conversation with a support agent for a fictional grocery shop.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No GEMINI_API_KEY is configured on this deployment, so the microphone path is off." },
      { status: 503 },
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const token = await ai.authTokens.create({
      config: {
        // One socket per token, and it has to be opened within a minute.
        uses: 1,
        expireTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            temperature: 0.75,
            // Both directions transcribed: the customer side becomes the call
            // record, the agent side lets the UI show what it just said.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } },
            },
            systemInstruction: { parts: [{ text: AGENT_SYSTEM_PROMPT }] },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    if (!token.name) throw new Error("The token service returned no token name.");

    // The model is returned with the token so the client cannot disagree with
    // the constraint the token was minted under — a mismatch there fails the
    // socket with an opaque error.
    return NextResponse.json({
      token: token.name,
      model: LIVE_MODEL,
      greeting: AGENT_GREETING,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Could not create a voice session: ${message}`,
        hint: /not found|404/i.test(message)
          ? `The live model "${LIVE_MODEL}" may not be available on this key. Set TARANG_LIVE_MODEL to another live model.`
          : undefined,
      },
      { status: 502 },
    );
  }
}
