/**
 * Extraction eval harness.
 *
 * The seeded corpus was built from scripted scenarios, so every call already
 * carries the ground-truth values it was generated from. That makes it a
 * labelled eval set at zero cost, which is the main reason the generator writes
 * ground truth into the record instead of only into the transcript.
 *
 * The harness scores two systems over the identical inputs:
 *   - the real model, through the actual /api/extract route
 *   - the keyword rules engine, through the same route with forceLocal
 *
 * Scoring against a baseline rather than against chance is the point. "The
 * model gets intent right 91% of the time" means very little on its own; "the
 * model gets it right 91% of the time where regexes get 62%" is a claim about
 * whether the model is earning its cost.
 *
 * Usage:
 *   npm run eval
 *
 * Reuses a dev server if one is running, otherwise starts and stops its own.
 * Writes public/data/eval-results.json, which the "How it works" page renders.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "public", "data");
const LIMIT = Number(process.env.TARANG_EVAL_N || 0);
const CONCURRENCY = 4;

/** Port used when this script has to bring up its own server. */
const OWN_PORT = 3123;
let BASE = process.env.TARANG_URL || "http://localhost:3000";
let ownServer = null;

async function reachable(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reuses a dev server if one is already up, and otherwise starts its own on a
 * different port. Running the eval should be one command, not "open a second
 * terminal first" — that instruction is where most people stop reading.
 */
async function ensureServer() {
  if (await reachable(BASE)) {
    console.log(`Using the server already running at ${BASE}\n`);
    return;
  }

  console.log(`No server on ${BASE} — starting one on port ${OWN_PORT}…`);
  ownServer = spawn("npx", ["next", "dev", "-p", String(OWN_PORT)], {
    cwd: ROOT,
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  BASE = `http://localhost:${OWN_PORT}`;

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    if (await reachable(BASE)) {
      console.log(`Server ready at ${BASE}\n`);
      return;
    }
  }
  stopServer();
  throw new Error(`The dev server did not come up on port ${OWN_PORT} within 90s.`);
}

function stopServer() {
  if (!ownServer) return;
  const pid = ownServer.pid;
  ownServer = null;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      // Synchronous on purpose: this also runs from the 'exit' handler, and
      // process.exit would tear us down before an async spawn ever ran, which
      // leaves a next dev server holding the port forever.
      // /T because next dev spawns children that would otherwise be orphaned.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

/** Field-by-field comparison. Not every field deserves exact-match scoring. */
const FIELDS = [
  { key: "primaryIntent", kind: "exact" },
  { key: "rootCause", kind: "exact" },
  { key: "resolution", kind: "exact" },
  { key: "resolved", kind: "exact" },
  { key: "contained", kind: "exact" },
  { key: "refundRequested", kind: "exact" },
  // A rating is ordinal, so being one point out is a different kind of wrong
  // from being three points out. Scored as within-one.
  { key: "csatPredicted", kind: "within", tolerance: 1 },
  // Risk scores are continuous judgements; nobody can label these to two
  // decimal places, so agreement means landing in the same band.
  { key: "escalationRisk", kind: "within", tolerance: 0.25 },
  { key: "churnRisk", kind: "within", tolerance: 0.25 },
];

function agrees(field, predicted, truth) {
  if (predicted === undefined || predicted === null) return false;
  if (field.kind === "exact") return predicted === truth;
  return Math.abs(Number(predicted) - Number(truth)) <= field.tolerance;
}

async function extract(transcript, meta, forceLocal) {
  const res = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, ...meta, forceLocal }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          out[i] = await fn(items[i], i);
        } catch (e) {
          out[i] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }),
  );
  return out;
}

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
  const transcripts = JSON.parse(fs.readFileSync(path.join(DATA, "transcripts.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf8"));

  const byId = new Map(index.map((c) => [c.id, c]));
  let ids = meta.evalIds.filter((id) => byId.has(id) && transcripts[id]);
  if (LIMIT > 0) ids = ids.slice(0, LIMIT);

  await ensureServer();

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.hasGeminiKey) {
    console.error("\nNo GEMINI_API_KEY is set, so the 'model' column would just be the rules engine again.");
    console.error("Run `npm run setup` to add one, then try this again.\n");
    process.exit(1);
  }

  console.log(`Evaluating ${ids.length} calls on ${health.model}\n`);

  let done = 0;
  const results = await mapLimit(ids, CONCURRENCY, async (id) => {
    const truth = byId.get(id);
    const turns = transcripts[id];
    const callMeta = {
      city: truth.customer.city,
      orderId: truth.order?.id ?? null,
      orderValue: truth.order?.valueInr ?? null,
      durationSec: truth.durationSec,
    };

    const [llm, rules] = await Promise.all([
      extract(turns, callMeta, false),
      extract(turns, callMeta, true),
    ]);

    done++;
    process.stdout.write(`\r  ${done}/${ids.length} calls scored`);
    return { id, truth, llm, rules };
  });

  process.stdout.write("\n\n");

  const usable = results.filter((r) => r && !r.error && r.llm?.insight);
  const failed = results.length - usable.length;

  if (!usable.length) {
    console.error("Every call failed. Check the server logs.");
    process.exit(1);
  }

  const modelRuns = usable.filter((r) => r.llm.extractedBy === "llm");
  if (!modelRuns.length) {
    console.error("No call reached the model — every one fell back to the rules engine. Check the API key and server logs.");
    process.exit(1);
  }

  const scored = FIELDS.map((f) => {
    const llmHits = usable.filter((r) => agrees(f, r.llm.insight[f.key], r.truth[f.key])).length;
    const ruleHits = usable.filter((r) => agrees(f, r.rules.insight[f.key], r.truth[f.key])).length;
    return { field: f.key, llm: llmHits / usable.length, rules: ruleHits / usable.length };
  });

  const meanLatencyMs = modelRuns.reduce((a, r) => a + (r.llm.extractionMs || 0), 0) / modelRuns.length;
  const meanCostUsd = modelRuns.reduce((a, r) => a + (r.llm.extractionCostUsd || 0), 0) / modelRuns.length;

  // The signal field is scored separately: it is not in the ground-truth
  // comparison above because "did it correctly decide NOT to raise a signal"
  // matters as much as the reverse, and precision/recall says that better than
  // an accuracy percentage.
  const truePos = usable.filter((r) => r.truth.productSignal && r.llm.insight.productSignal).length;
  const falsePos = usable.filter((r) => !r.truth.productSignal && r.llm.insight.productSignal).length;
  const falseNeg = usable.filter((r) => r.truth.productSignal && !r.llm.insight.productSignal).length;
  const precision = truePos + falsePos ? truePos / (truePos + falsePos) : 0;
  const recall = truePos + falseNeg ? truePos / (truePos + falseNeg) : 0;

  const notes = [
    `Product signal: precision ${(precision * 100).toFixed(0)}%, recall ${(recall * 100).toFixed(0)}% over ${usable.length} calls. Scored separately from the table because correctly declining to raise a signal matters as much as raising one.`,
  ];
  if (failed) notes.push(`${failed} call${failed === 1 ? "" : "s"} errored and were excluded.`);
  if (modelRuns.length < usable.length) {
    notes.push(`${usable.length - modelRuns.length} call(s) fell back to the rules engine mid-run and are scored in the model column as such.`);
  }

  const out = {
    ranAt: new Date().toISOString(),
    model: modelRuns[0].llm.model || "unknown",
    n: usable.length,
    fields: scored,
    meanLatencyMs,
    meanCostUsd,
    notes,
  };

  fs.writeFileSync(path.join(DATA, "eval-results.json"), JSON.stringify(out, null, 2));

  console.log("field                model    rules    delta");
  console.log("---------------------------------------------");
  for (const s of scored) {
    const d = (s.llm - s.rules) * 100;
    console.log(
      `${s.field.padEnd(20)} ${(s.llm * 100).toFixed(0).padStart(4)}%   ${(s.rules * 100).toFixed(0).padStart(4)}%   ${(d >= 0 ? "+" : "") + d.toFixed(0)}`,
    );
  }
  console.log(`\nproduct signal       precision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%`);
  console.log(`mean latency ${Math.round(meanLatencyMs)}ms   mean cost $${meanCostUsd.toFixed(4)}/call`);
  console.log(`\nWrote public/data/eval-results.json — the How it works page now shows these numbers.`);
}

main().catch((e) => {
  stopServer();
  console.error(`
${e instanceof Error ? e.message : e}
`);
  process.exit(1);
});
