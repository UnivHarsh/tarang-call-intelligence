/**
 * One-command setup.
 *
 * Asks for the Gemini key, writes .env.local, proves the key works with a real
 * schema-constrained call, then runs the eval so the accuracy table on the
 * "How it works" page is filled with measured numbers rather than a placeholder.
 *
 *   npm run setup
 *
 * Safe to re-run. It never overwrites an existing key without asking.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function readEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function writeEnvLocal(vars) {
  const body = [
    "# Written by `npm run setup`. This file is gitignored — the key never leaves your machine.",
    "",
    "# Extraction. Free key from https://aistudio.google.com/apikey",
    `GEMINI_API_KEY=${vars.GEMINI_API_KEY ?? ""}`,
    "",
    "# Optional model override: gemini-3.7-flash | gemini-2.5-flash | gemini-2.5-flash-lite",
    `TARANG_MODEL=${vars.TARANG_MODEL ?? ""}`,
    "",
    "# Optional, only for the microphone demo. Public key from https://dashboard.vapi.ai",
    `NEXT_PUBLIC_VAPI_PUBLIC_KEY=${vars.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? ""}`,
    "",
  ].join("\n");
  fs.writeFileSync(ENV_PATH, body);
}

/**
 * Spawns a node script. Deliberately no `shell: true` — on Windows
 * process.execPath is "C:\\Program Files\\nodejs\\node.exe", and a shell splits
 * that on the space and tries to run "C:\\Program".
 */
/**
 * readline's question() never settles if stdin has already ended, which hangs
 * the process instead of failing. Guard the ended case and otherwise race
 * against close, so a piped or non-interactive run exits cleanly.
 */
async function ask(prompt) {
  if (!input.isTTY && (input.readableEnded || !input.readable)) return "";
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await Promise.race([
      rl.question(prompt),
      new Promise((resolve) => rl.once("close", () => resolve(""))),
    ]);
    return (answer ?? "").trim();
  } finally {
    rl.close();
  }
}

function runNode(scriptPath) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [scriptPath], { cwd: ROOT, stdio: "inherit" });
    p.on("close", (code) => resolve(code ?? 1));
    p.on("error", () => resolve(1));
  });
}

console.log(`\n${bold("Tarang setup")}\n`);

const existing = readEnvLocal();
let key = existing.GEMINI_API_KEY || "";

if (key) {
  console.log(`  Found an existing key in .env.local ending ${dim("..." + key.slice(-4))}`);
  const keep = (await ask("  Keep it? [Y/n] ")).toLowerCase();
  if (keep === "n") key = "";
  console.log("");
}

if (!key) {
  console.log(`  ${bold("Step 1 of 1 for you:")} paste a Gemini API key.`);
  console.log(`  Get one free at ${bold("https://aistudio.google.com/apikey")}`);
  console.log(dim("  (Google account only. No credit card, no billing setup, no subscription.)\n"));

  key = await ask("  Paste the key here: ");

  if (!key) {
    console.log(`\n  ${yellow("No key entered.")} Nothing was written.`);
    console.log(dim("  The app still runs without one — it just falls back to the keyword engine.\n"));
    process.exit(0);
  }
  if (!/^AIza[\w-]{20,}$/.test(key)) {
    console.log(`\n  ${yellow("Heads up:")} Google keys normally start with "AIza". Continuing anyway.`);
  }
}

// --- voice layer (optional) -------------------------------------------------
// The site works without this: the live page falls back to Gemini Live and to
// transcript replay. With it, the "talk to the agent" button runs on a real
// telephony-grade voice stack, which is what makes the demo worth clicking.
let vapi = existing.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "";
if (vapi) {
  console.log(`  Found a Vapi public key ending ${dim("..." + vapi.slice(-4))}`);
} else {
  console.log(`  ${bold("Optional:")} a Vapi public key turns on the live voice demo.`);
  console.log(`  Free credits at ${bold("https://vapi.ai")} > Dashboard > API Keys > Public key.`);
  console.log(dim("  Press Enter to skip. You can re-run npm run setup later to add it.\n"));
  vapi = (await ask("  Paste the Vapi PUBLIC key (or Enter to skip): ")).trim();
}
console.log("");

writeEnvLocal({ ...existing, GEMINI_API_KEY: key, NEXT_PUBLIC_VAPI_PUBLIC_KEY: vapi });
console.log(`\n  ${green("✓")} Wrote .env.local ${dim("(gitignored — this never gets committed)")}\n`);

// --- verify -----------------------------------------------------------------
console.log(bold("  Checking the key against the real API…\n"));
process.env.GEMINI_API_KEY = key;

const checkCode = await runNode(path.join(__dirname, "check-key.mjs"));
if (checkCode !== 0) {
  console.log(`  ${red("Setup stopped.")} Fix the problem above and run ${bold("npm run setup")} again.\n`);
  process.exit(1);
}

// --- eval -------------------------------------------------------------------
console.log(bold("  Measuring extraction accuracy on 45 labelled calls…"));
console.log(dim("  This fills in the table on the How it works page. Takes a couple of minutes.\n"));

const evalCode = await runNode(path.join(__dirname, "eval-extraction.mjs"));

if (evalCode === 0) {
  console.log(`\n  ${green("✓")} Everything is set up.\n`);
} else {
  console.log(`\n  ${yellow("The eval did not finish")}, but your key works and the app is fully functional.`);
  console.log(dim("  The How it works page will show a placeholder instead of the accuracy table.\n"));
}

console.log(`  Next:  ${bold("npm run dev")}     see it locally at http://localhost:3000`);
console.log(`         ${bold("npm run deploy")}  put it online and get a shareable link\n`);
