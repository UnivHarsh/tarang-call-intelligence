/**
 * The same benchmark, on a real human voice.
 *
 * Every number on the Speech accuracy page comes from text-to-speech audio:
 * clean, evenly paced, one microphone, no room, no phone line. That makes the
 * rates a floor rather than an estimate, and it is the first thing anyone
 * reading the page should be suspicious of.
 *
 * This script closes that gap with the cheapest possible instrument: a person
 * reading the same lines into a phone. Ten recordings are not a corpus, but
 * "10.5% on synthetic audio and X% on real speech" is a far more honest pair of
 * numbers than either one alone, and the gap between them is itself the finding.
 *
 *   npm run asr:script    prints the lines to read, and writes them to a file
 *   npm run asr:real      scores whatever recordings are in real-audio/
 *
 * Recordings are matched to lines by filename number: 01, 02, 03 and so on. Any
 * common audio format works. Files that are missing are skipped rather than
 * guessed at, so a half-finished recording session still produces a valid run
 * over the lines that exist.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKey, transcribe, sleep, SYSTEMS } from "./asr/gemini.mjs";
import { report, ladder, cer } from "./asr/wer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const AUDIO_IN = path.join(ROOT, "real-audio");
const N = Number(process.env.TARANG_REAL_N || 10);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const MIME = {
  ".wav": "audio/wav", ".mp3": "audio/mp3", ".m4a": "audio/mp4", ".mp4": "audio/mp4",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".aiff": "audio/aiff", ".amr": "audio/amr", ".3gp": "audio/3gpp",
};

/**
 * The same selection rule the synthetic bench uses, so the two runs are
 * comparable. Changing which lines are read would make the gap between
 * synthetic and real audio meaningless.
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

function pickLines(n) {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
  const transcripts = JSON.parse(fs.readFileSync(path.join(DATA, "transcripts.json"), "utf8"));
  const out = [];
  const seenShapes = new Set();
  for (const call of index) {
    if (out.length >= n) break;
    const line = (transcripts[call.id] || []).find(
      (t) => t.role === "customer" && String(t.text || "").split(/\s+/).length >= 9,
    );
    if (!line) continue;
    const key = shape(line.text);
    if (seenShapes.has(key)) continue;
    seenShapes.add(key);
    out.push({ callId: call.id, text: String(line.text).trim() });
  }
  return out;
}

function printScript(lines) {
  fs.mkdirSync(AUDIO_IN, { recursive: true });
  const body = lines
    .map((l, i) => `${String(i + 1).padStart(2, "0")}. ${l.text}`)
    .join("\n\n");
  const file = path.join(AUDIO_IN, "SCRIPT.txt");
  fs.writeFileSync(file, body + "\n");

  console.log(`\n${bold("Read these out loud, one recording per line.")}\n`);
  console.log(body);
  console.log(`\n${dim("Saved to real-audio/SCRIPT.txt")}\n`);
  console.log(bold("  How to record"));
  console.log("  1. Use your phone's voice recorder. Normal room, normal pace.");
  console.log("  2. One file per line. Do not re-read a line until it sounds perfect;");
  console.log("     the whole point is that real speech is not perfect.");
  console.log(`  3. Name them 01, 02, 03 … and drop them in ${bold("real-audio/")}`);
  console.log(`  4. Run ${bold("npm run asr:real")}\n`);
  console.log(dim("  Say the order IDs the way you would on a phone. Those are the hard part.\n"));
}

function findRecording(i) {
  if (!fs.existsSync(AUDIO_IN)) return null;
  const stem = String(i + 1).padStart(2, "0");
  for (const f of fs.readdirSync(AUDIO_IN)) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) continue;
    const base = path.basename(f, ext).replace(/\D/g, "");
    if (base && Number(base) === i + 1) return { file: path.join(AUDIO_IN, f), mime: MIME[ext] };
  }
  return null;
}

async function main() {
  const lines = pickLines(N);
  if (process.argv.includes("--script")) return printScript(lines);

  const key = loadKey();
  if (!key) {
    console.error(`\n  ${yellow("No GEMINI_API_KEY found.")} Run ${bold("npm run setup")} first.\n`);
    process.exit(1);
  }

  const found = lines.map((l, i) => ({ ...l, rec: findRecording(i) })).filter((l) => l.rec);
  if (!found.length) {
    console.log(`\n  ${yellow("No recordings found in real-audio/.")}`);
    console.log(`  Run ${bold("npm run asr:script")} first, record the lines, then come back.\n`);
    process.exit(0);
  }

  console.log(`\n${bold("Real-voice benchmark")}  ${dim(`${found.length} of ${lines.length} lines recorded`)}\n`);

  const pairs = Object.fromEntries(SYSTEMS.map((s) => [s.id, []]));
  const examples = [];
  const offScript = [];

  /*
   * Reference and audio have to actually match.
   *
   * A human reading a script adds words. Two of the first ten recordings here
   * were ad-libbed: the speaker said the line and then kept talking. Every
   * system transcribed that correctly and scored above 120%, because the
   * reference was wrong, not the recogniser. Reporting those as recognition
   * errors would be publishing a bookkeeping mistake as a finding.
   *
   * Detection is deliberately blunt and conservative: if every system returns
   * far more words than the reference contains, they all heard something the
   * script does not have. Systems disagreeing with each other is a model
   * problem; systems agreeing that there is more audio is a script problem.
   */
  const wordCount = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

  for (let i = 0; i < found.length; i++) {
    const l = found[i];
    const buf = fs.readFileSync(l.rec.file);
    const heard = {};
    for (const system of SYSTEMS) {
      try {
        const r = await transcribe(buf, system, key, l.rec.mime);
        pairs[system.id].push({ reference: l.text, hypothesis: r.text });
        heard[system.id] = r.text;
      } catch (e) {
        console.log(`  ${yellow(system.id)} ${dim(String(e.message).slice(0, 60))}`);
      }
      await sleep(1500);
    }
    const refWords = wordCount(l.text);
    const ratios = Object.values(heard).map((t) => wordCount(t) / Math.max(1, refWords));
    const drift = ratios.length ? Math.min(...ratios) : 0;

    if (drift > 1.35) {
      // Every system heard at least a third more words than the script holds.
      offScript.push({ callId: l.callId, reference: l.text, heard, ratio: Number(drift.toFixed(2)) });
      for (const s of SYSTEMS) pairs[s.id].pop();
      console.log(`  ${String(i + 1).padStart(2)}/${found.length}  ${yellow("off script")} ${dim(`spoke ${drift.toFixed(1)}x the words, excluded`)}`);
      continue;
    }

    const summary = SYSTEMS.filter((s) => heard[s.id] !== undefined)
      .map((s) => `${s.id} ${pct(ladder(l.text, heard[s.id]).at(-1).wer)}`)
      .join("  ");
    console.log(`  ${String(i + 1).padStart(2)}/${found.length}  ${summary}`);
    if (examples.length < 2) examples.push({ callId: l.callId, reference: l.text, heard });
  }

  const systems = SYSTEMS.map((s) => {
    const p = pairs[s.id];
    if (!p.length) return { id: s.id, label: s.label, unavailable: "no successful runs" };
    const rep = report(p);
    return {
      id: s.id, label: s.label, n: p.length,
      wer: rep.headline.wer, werRaw: rep.byStage[0].wer,
      cer: p.reduce((a, x) => a + cer(x.reference, x.hypothesis), 0) / p.length,
    };
  });

  const resultsPath = path.join(DATA, "asr-results.json");
  const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  results.realVoice = {
    ranAt: new Date().toISOString(),
    lines: found.length - offScript.length,
    recorded: found.length,
    systems,
    examples,
    offScript,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  console.log(`\n${bold("  system                            raw    normalised")}`);
  console.log(dim("  --------------------------------------------------"));
  for (const s of systems) {
    if (s.unavailable) { console.log(`  ${s.label.padEnd(32)} ${yellow(s.unavailable)}`); continue; }
    console.log(`  ${s.label.padEnd(32)} ${pct(s.werRaw).padStart(6)} ${pct(s.wer).padStart(12)}`);
  }
  console.log(`\n  ${green("✓")} Added to asr-results.json as the real-voice comparison\n`);
}

main().catch((e) => {
  console.error(`\n  ${yellow("Failed:")} ${e.message}\n`);
  process.exit(1);
});
