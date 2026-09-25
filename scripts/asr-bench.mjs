/**
 * ASR benchmark.
 *
 * Speech recognition is the weak link in this pipeline, and the "How it works"
 * page has said so since the first version without ever putting a number on it.
 * This measures it.
 *
 * The method, and why each choice was made:
 *
 *   Reference. Lines are taken from the seeded corpus, where the exact words are
 *   already known. Word error rate is a comparison against the truth, so without
 *   a known truth there is nothing to compare. Real recordings would be better
 *   and would need someone to hand-label every second of them.
 *
 *   Audio. Each line is spoken by a text-to-speech model. That makes the clips
 *   clean, evenly paced and free of the noise, codec loss and overlap of a real
 *   phone line, so every number here is a ceiling rather than an estimate. It is
 *   still the honest way to compare recognisers, because all of them hear the
 *   identical file.
 *
 *   Systems. Two share a model and differ only in the instruction, which
 *   isolates the prompt. A third holds the instruction and changes the model,
 *   which isolates the model. Changing both at once produces a table you cannot
 *   draw a conclusion from.
 *
 *   Scoring. Every pair is scored eight times, from no normalisation to full,
 *   so the report separates what the recogniser got wrong from what the scoring
 *   convention got wrong. On code-mixed speech those are usually not the same
 *   thing, and the gap between them is the actual finding.
 *
 * Usage:
 *   npm run asr            12 lines, all systems
 *   TARANG_ASR_N=30 npm run asr
 *
 * Writes public/data/asr-results.json, plus a few clips into public/audio so the
 * page can play the exact file each system heard.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, speakRotating, transcribe, sleep, SYSTEMS, VOICES } from "./asr/gemini.mjs";
import { report, ladder, cer, STAGES } from "./asr/wer.mjs";
import { hasDevanagari } from "./asr/translit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const AUDIO = path.join(ROOT, "public", "audio");

const N = Number(process.env.TARANG_ASR_N || 12);
const THROTTLE_MS = Number(process.env.TARANG_ASR_THROTTLE_MS || 1500);
const KEEP_CLIPS = Number(process.env.TARANG_ASR_CLIPS || 3);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * Picks the lines to speak.
 *
 * Customer turns only, because that is where the code-mixing, the frustration
 * and the mumbled order numbers live. Agent turns are scripted and clean, and a
 * benchmark padded with them would report a flattering number that says nothing
 * about the hard case. Spread across distinct calls so one caller's phrasing
 * cannot dominate, and long enough that a single word cannot swing the rate.
 */

/**
 * Collapses templated near-duplicates.
 *
 * The corpus is generated from scenarios, so "mera refund abhi tak nahi aaya,
 * 10 din ho gaye" recurs with only the number changing. Three copies of one
 * sentence is not three samples: it triples the weight of whatever that
 * sentence happens to expose and hides everything it does not.
 */
const shape = (t) =>
  String(t).toLowerCase().replace(/[0-9]+/g, "#").replace(/[^a-z#\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 55);

function pickLines(index, transcripts, n) {
  const out = [];
  const seenCalls = new Set();
  const seenShapes = new Set();
  for (const call of index) {
    if (out.length >= n) break;
    if (seenCalls.has(call.id)) continue;
    const turns = transcripts[call.id] || [];
    const line = turns.find(
      (t) => t.role === "customer" && String(t.text || "").split(/\s+/).length >= 9,
    );
    if (!line) continue;
    const key = shape(line.text);
    if (seenShapes.has(key)) continue;
    seenShapes.add(key);
    seenCalls.add(call.id);
    out.push({
      callId: call.id,
      language: call.language,
      text: String(line.text).trim(),
      words: String(line.text).trim().split(/\s+/).length,
    });
  }
  return out;
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error(`\n  ${yellow("No GEMINI_API_KEY found.")} Run ${bold("npm run setup")} first.\n`);
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
  const transcripts = JSON.parse(fs.readFileSync(path.join(DATA, "transcripts.json"), "utf8"));
  const lines = pickLines(index, transcripts, N);

  fs.mkdirSync(AUDIO, { recursive: true });

  console.log(`\n${bold("ASR benchmark")}  ${dim(`${lines.length} lines, ${SYSTEMS.length} systems`)}\n`);

  const pairs = Object.fromEntries(SYSTEMS.map((s) => [s.id, []]));
  const latency = Object.fromEntries(SYSTEMS.map((s) => [s.id, []]));
  const unavailable = {};
  const examples = [];
  const ttsExhausted = new Set();
  const voicesUsed = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${lines.length}  speaking…`);

    let wav, voiceUsed;
    try {
      const spoken = await speakRotating(line.text, { key, index: i, exhausted: ttsExhausted });
      wav = spoken.wav;
      voiceUsed = `${spoken.model} / ${spoken.voice}`;
      voicesUsed.add(voiceUsed);
    } catch (e) {
      console.log(`\r  ${String(i + 1).padStart(2)}/${lines.length}  ${yellow("no voice available")} ${dim(String(e.message).slice(0, 50))}`);
      if (ttsExhausted.size >= VOICES.length) {
        console.log(dim("\n  Every speech model is out of free-tier quota. Stopping rather than reporting a thin sample."));
        break;
      }
      continue;
    }
    await sleep(THROTTLE_MS);

    const clipName = `line-${String(i + 1).padStart(2, "0")}.wav`;
    if (examples.length < KEEP_CLIPS) fs.writeFileSync(path.join(AUDIO, clipName), wav);

    const heard = {};
    for (const system of SYSTEMS) {
      if (unavailable[system.id]) continue;
      try {
        const r = await transcribe(wav, system, key);
        pairs[system.id].push({ reference: line.text, hypothesis: r.text });
        latency[system.id].push(r.latencyMs);
        heard[system.id] = r.text;
      } catch (e) {
        const msg = String(e.message);
        // A quota wall is not a result. Record why the arm stopped rather than
        // reporting a partial sample as if it were the full one.
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
          unavailable[system.id] = "daily free-tier quota exhausted";
        } else {
          unavailable[system.id] = msg.slice(0, 80);
        }
      }
      await sleep(THROTTLE_MS);
    }

    if (examples.length < KEEP_CLIPS) {
      examples.push({
        clip: `/audio/${clipName}`,
        callId: line.callId,
        reference: line.text,
        heard,
        ladders: Object.fromEntries(
          Object.entries(heard).map(([id, text]) => [id, ladder(line.text, text).map((l) => ({ stage: l.stage, wer: l.wer }))]),
        ),
      });
    }

    const summary = SYSTEMS
      .filter((s) => heard[s.id] !== undefined)
      .map((s) => `${s.id} ${pct(ladder(line.text, heard[s.id]).at(-1).wer)}`)
      .join("  ");
    console.log(`\r  ${String(i + 1).padStart(2)}/${lines.length}  ${summary}${" ".repeat(20)}`);
  }

  const systems = SYSTEMS.map((s) => {
    const p = pairs[s.id];
    if (!p.length) {
      return { id: s.id, label: s.label, model: s.model, note: s.note, unavailable: unavailable[s.id] || "no successful runs" };
    }
    const rep = report(p);
    return {
      id: s.id,
      label: s.label,
      model: s.model,
      note: s.note,
      prompt: s.prompt,
      n: p.length,
      byStage: rep.byStage.map((b) => ({ stage: b.stage, wer: b.wer, sub: b.sub, del: b.del, ins: b.ins })),
      wer: rep.headline.wer,
      werRaw: rep.byStage[0].wer,
      cer: p.reduce((a, x) => a + cer(x.reference, x.hypothesis), 0) / p.length,
      devanagariShare: rep.scriptSplit.devanagariShare,
      meanLatencyMs: latency[s.id].reduce((a, b) => a + b, 0) / latency[s.id].length,
      unavailable: unavailable[s.id] || null,
    };
  });

  const out = {
    ranAt: new Date().toISOString(),
    lines: lines.length,
    voices: [...voicesUsed].sort(),
    stages: STAGES,
    systems,
    examples,
    limitations: [
      "Audio is text to speech, not a phone line. No background noise, no codec loss, no overlapping speech, no accent variation. Every rate here is a floor on the error a real deployment would see.",
      "References come from a synthetic corpus, so the vocabulary is narrower and more consistent than real customer speech.",
      "A handful of synthetic voices, no real speakers. Real Indic ASR performance varies enormously by speaker, accent and region, and none of it is captured here.",
      "Transliteration is rule-based, so the script stage removes most but not all of the Devanagari penalty. The residue is counted against the recogniser, which is the conservative direction to be wrong in.",
    ],
  };

  fs.writeFileSync(path.join(DATA, "asr-results.json"), JSON.stringify(out, null, 2));

  /*
   * Append the headline of every run to a history file.
   *
   * A single benchmark run is one sample of a stochastic system, and the second
   * run here moved the plain-instruction arm by fourteen points while the
   * code-mix arm moved by half a point. That difference is the most useful thing
   * either run produced, and it only exists because both were kept. An eval that
   * overwrites itself can never tell you which of its numbers you can trust.
   */
  const HISTORY = path.join(DATA, "asr-history.json");
  const history = fs.existsSync(HISTORY) ? JSON.parse(fs.readFileSync(HISTORY, "utf8")) : [];
  history.push({
    ranAt: out.ranAt,
    lines: systems.find((s) => s.n)?.n ?? 0,
    systems: systems
      .filter((s) => !s.unavailable)
      .map((s) => ({ id: s.id, wer: s.wer, werRaw: s.werRaw, devanagariShare: s.devanagariShare })),
  });
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));

  console.log(`\n${bold("  system                            raw    normalised    CER   latency")}`);
  console.log(dim("  ---------------------------------------------------------------------"));
  for (const s of systems) {
    if (s.unavailable) {
      console.log(`  ${s.label.padEnd(32)} ${yellow(s.unavailable)}`);
      continue;
    }
    console.log(
      `  ${s.label.padEnd(32)} ${pct(s.werRaw).padStart(6)} ${pct(s.wer).padStart(12)} ` +
      `${pct(s.cer).padStart(7)} ${String(Math.round(s.meanLatencyMs) + "ms").padStart(8)}`,
    );
  }
  console.log(`\n  ${green("✓")} Wrote public/data/asr-results.json\n`);
}

main().catch((e) => {
  console.error(`\n  ${yellow("Benchmark failed:")} ${e.message}\n`);
  process.exit(1);
});
