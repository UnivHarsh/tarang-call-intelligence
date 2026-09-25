/**
 * The two model calls the ASR bench needs: speech out, and speech back in.
 *
 * Deliberately written against the REST endpoint rather than the SDK. The bench
 * has to pin an exact model string per system and compare them, and going
 * through a helper that silently falls back to another model would destroy the
 * only thing the benchmark is measuring.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const API = "https://generativelanguage.googleapis.com/v1beta/models";

export function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) return "";
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One POST, with retry on the transient 429 and 503 the free tier produces. */
async function call(model, body, key, attempts = 4) {
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2500 * i);
    const res = await fetch(`${API}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    lastErr = `${res.status} ${json?.error?.message || ""}`.slice(0, 160);
    const transient = res.status === 429 || res.status >= 500;
    if (!transient) break;
  }
  throw new Error(lastErr || "request failed");
}

/**
 * Wraps raw PCM in a WAV header when a model returns L16 rather than wav, so
 * every clip downstream is one format. Without this the transcription step
 * silently receives headerless bytes and returns confident nonsense.
 */
function toWav(base64, mimeType) {
  if (/wav/i.test(mimeType)) return Buffer.from(base64, "base64");
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] || 24000);
  const pcm = Buffer.from(base64, "base64");
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);   // PCM
  head.writeUInt16LE(1, 22);   // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/**
 * Speaks a line of Hinglish and returns WAV bytes.
 *
 * Only the line itself is sent. A text-to-speech model speaks whatever content
 * it is given, so an instruction wrapper like "read the following exactly" gets
 * read out loud as part of the clip. That happened on the first run here: two
 * of three clips were the instruction being narrated, and the recogniser dutifully
 * transcribed it, producing word error rates above 300%. A number that absurd is
 * a bug report, not a finding, and it is worth saying out loud that the check
 * which caught it was reading the transcripts rather than trusting the metric.
 */
export async function speak(text, { key, model = "gemini-3.8-flash-lite-tts", voice = "Kore" }) {
  const json = await call(model, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  }, key, 2);

  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("no audio returned");
  return toWav(part.inlineData.data, part.inlineData.mimeType || "");
}

/**
 * Voices to read the corpus in.
 *
 * The first version of this benchmark used one model and one voice, which made
 * every clip identical in pace and timbre and turned the result into a claim
 * about a single synthetic speaker. Rotating widens the acoustic variety, and
 * has the practical benefit that free-tier quota is counted per model, so the
 * sample can be large enough to mean something.
 *
 * The rotation is deterministic, so a re-run scores the same audio, and the
 * model and voice used are recorded per line rather than averaged away.
 */
export const VOICES = [
  { model: "gemini-3.8-flash-lite-tts", voice: "Kore" },
  { model: "gemini-3.8-flash-lite-tts", voice: "Puck" },
  { model: "gemini-2.5-flash-preview-tts", voice: "Charon" },
  { model: "gemini-2.5-flash-preview-tts", voice: "Aoede" },
  { model: "gemini-3.1-flash-tts-preview", voice: "Kore" },
  { model: "gemini-3.8-flash-tts", voice: "Puck" },
];

/**
 * Speaks a line, walking the voice list until one answers.
 *
 * `exhausted` is a shared set the caller owns: once a model returns a quota
 * error it is skipped for the rest of the run rather than retried per line,
 * which otherwise burns minutes waiting on a wall that will not move.
 */
export async function speakRotating(text, { key, index, exhausted }) {
  const order = VOICES.map((_, i) => VOICES[(index + i) % VOICES.length]);
  let lastErr = new Error("no voice available");
  for (const v of order) {
    if (exhausted.has(v.model)) continue;
    try {
      const wav = await speak(text, { key, model: v.model, voice: v.voice });
      return { wav, ...v };
    } catch (e) {
      lastErr = e;
      if (/429|quota|RESOURCE_EXHAUSTED/i.test(String(e.message))) exhausted.add(v.model);
    }
  }
  throw lastErr;
}

/**
 * The three systems under test.
 *
 * One variable moves across all three: the instruction. Same model, same audio,
 * same decoding settings, so any difference in the table is attributable to the
 * prompt and to nothing else. Swapping the model as well would have produced a
 * table nobody could draw a conclusion from.
 *
 * The third arm asks for the opposite script on purpose. It is not a system
 * anyone would ship; it is the control that shows how much of a published WER
 * number is a scoring convention rather than a recognition failure.
 */
export const SYSTEMS = [
  {
    id: "naive",
    label: "Flash-Lite, plain instruction",
    model: "gemini-3.5-flash-lite",
    prompt: "Transcribe this audio.",
    thinking: false,
    note: "The instruction most people write first.",
  },
  {
    id: "codemix",
    label: "Flash-Lite, code-mix instruction",
    model: "gemini-3.5-flash-lite",
    prompt:
      "Transcribe this Indian customer-support audio verbatim. The speech is " +
      "code-mixed Hindi and English. Write Hindi words in Roman script, not " +
      "Devanagari. Keep English words in English. Preserve order IDs and " +
      "amounts exactly as spoken. Output only the transcript, no commentary.",
    thinking: false,
    note: "Same model, same audio. Only the instruction changes.",
  },
  {
    id: "devanagari",
    label: "Flash-Lite, Devanagari requested",
    model: "gemini-3.5-flash-lite",
    prompt:
      "Transcribe this Indian customer-support audio verbatim. The speech is " +
      "code-mixed Hindi and English. Write the Hindi words in Devanagari script. " +
      "Preserve order IDs and amounts exactly as spoken. Output only the " +
      "transcript, no commentary.",
    thinking: false,
    note:
      "The control. Same model, same audio, script deliberately flipped, to show " +
      "how much of a WER number is the scoring convention rather than the recogniser.",
  },
];

/**
 * Sends WAV bytes to one system and returns its transcript plus timing.
 *
 * `thinkingConfig` is only sent to models that accept it. Flash-Lite rejects the
 * field outright with a 400, and a config option silently disqualifying one arm
 * of the benchmark is exactly the kind of bug that produces a confident,
 * completely wrong comparison table.
 */
export async function transcribe(wav, system, key, mimeType = "audio/wav") {
  const started = Date.now();
  const generationConfig = { temperature: 0 };
  if (system.thinking !== false) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const json = await call(system.model, {
    contents: [{
      parts: [
        { text: system.prompt },
        { inlineData: { mimeType, data: wav.toString("base64") } },
      ],
    }],
    generationConfig,
  }, key);

  let text = (json?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join(" ")
    .trim();

  // Reasoning models sometimes emit a "thought" line before the answer. Left in,
  // it is scored as a hallucinated insertion and the model looks worse than it is.
  text = text.replace(/^\s*(thought|thinking|transcript)\s*:?\s+/i, "").trim();
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();

  return { text, latencyMs: Date.now() - started };
}
