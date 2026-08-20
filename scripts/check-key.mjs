/**
 * Verifies the Gemini key end to end, without starting the app.
 *
 * It makes one small structured-output call using the same schema shape the
 * real extraction uses, so a pass here means the key, the model name, and the
 * JSON-schema decoding all work — not merely that the key is syntactically
 * valid. Costs nothing on the free tier.
 *
 *   npm run check-key
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/** Next.js loads .env.local for the app; a bare node script has to do it itself. */
function loadEnvLocal() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}

loadEnvLocal();

const key = process.env.GEMINI_API_KEY;
const model = process.env.TARANG_MODEL || "gemini-3.7-flash";

if (!key) {
  console.error("\n  ✕  GEMINI_API_KEY is not set.\n");
  console.error("     1. Get a free key at https://aistudio.google.com/apikey");
  console.error("     2. Create .env.local in the project root containing:\n");
  console.error("        GEMINI_API_KEY=your_key_here\n");
  process.exit(1);
}

console.log(`\n  Testing ${model} with a key ending ...${key.slice(-4)}\n`);

const ai = new GoogleGenAI({ apiKey: key });
const started = Date.now();

try {
  const response = await ai.models.generateContent({
    model,
    contents:
      "Transcript:\n[00:00] AGENT: Namaste, Kartly support.\n[00:04] CUSTOMER: Mera order do din late hai aur koi update nahi hai.",
    config: {
      systemInstruction: "You classify Hinglish customer support calls. Reply with JSON only.",
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string", enum: ["delivery_delay", "refund_status", "other"] },
          isHinglish: { type: "boolean" },
          oneLine: { type: "string" },
        },
        required: ["intent", "isHinglish", "oneLine"],
      },
      maxOutputTokens: 2048,
    },
  });

  const text = response.text;
  if (!text) {
    console.error(`  ✕  The model returned no text. finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}`);
    console.error("     Try raising maxOutputTokens, or a different model via TARANG_MODEL.\n");
    process.exit(1);
  }

  const parsed = JSON.parse(text);
  const u = response.usageMetadata;

  console.log("  ✓  Extraction: key works, model responded, JSON schema decoded.");
  console.log("     " + JSON.stringify(parsed));
  console.log(
    `     ${Date.now() - started}ms · ${u?.promptTokenCount ?? "?"} in / ${(u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0)} out tokens\n`,
  );

  // --- voice ----------------------------------------------------------------
  // The microphone demo needs a *different* model (native audio) and the
  // ephemeral-token service. Both can fail independently of the check above, so
  // they get their own check rather than being discovered at demo time.
  const liveModel = process.env.TARANG_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025";
  const liveVoice = process.env.TARANG_LIVE_VOICE || "Aoede";

  try {
    await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: liveModel,
          config: {
            responseModalities: ["AUDIO"],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoice } } },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    console.log(`  ✓  Voice: ${liveModel} is available and a session token was issued.`);
    console.log(`     Voice "${liveVoice}". The microphone demo will work.\n`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log(`  !  Voice: could not open a session on ${liveModel}.`);
    console.log(`     ${m.slice(0, 220)}`);
    if (/not found|404|NOT_FOUND|unsupported/i.test(m)) {
      console.log(`     Try another live model, e.g.:`);
      console.log(`       TARANG_LIVE_MODEL=gemini-3.1-flash-live-preview npm run check-key`);
      console.log(`     then add that line to .env.local.`);
    }
    console.log(`     Everything else still works — only the microphone button is affected.\n`);
  }

  console.log("     You are good to go. Start the app with:  npm run dev\n");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`  ✕  Failed after ${Date.now() - started}ms\n`);
  console.error(`     ${msg}\n`);

  if (/API key not valid|API_KEY_INVALID|401|403/i.test(msg)) {
    console.error("     The key was rejected. Generate a fresh one at https://aistudio.google.com/apikey");
    console.error("     and check you copied the whole string.\n");
  } else if (/not found|404|NOT_FOUND/i.test(msg)) {
    console.error(`     "${model}" was not found for this key. Try:  TARANG_MODEL=gemini-2.5-flash npm run check-key\n`);
  } else if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) {
    console.error("     Free-tier rate limit hit. Wait a minute and try again.\n");
  } else if (/fetch failed|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
    console.error("     Network problem reaching Google. Check your connection or proxy.\n");
  }
  process.exit(1);
}
