/**
 * One-command deploy to Vercel.
 *
 *   npm run deploy
 *
 * Links (or creates) the project, copies the keys from .env.local into the
 * project's environment, and ships a production build.
 *
 * Every step prints the plain `vercel ...` command it is about to run before it
 * runs it. If something fails you are never stuck — the message tells you the
 * exact command to finish by hand, and re-running this script is always safe.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const WIN = process.platform === "win32";

/** Runs a command with output shown. Returns the exit code. */
function run(args, { quiet = false } = {}) {
  if (!quiet) console.log(dim(`  $ npx vercel ${args.join(" ")}`));
  const r = spawnSync("npx", ["--yes", "vercel", ...args], {
    cwd: ROOT,
    stdio: quiet ? "pipe" : "inherit",
    shell: WIN,
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** Runs a command with a value piped to stdin. */
function runWithInput(args, value) {
  console.log(dim(`  $ npx vercel ${args.join(" ")}`));
  const r = spawnSync("npx", ["--yes", "vercel", ...args], {
    cwd: ROOT,
    input: value,
    stdio: ["pipe", "pipe", "pipe"],
    shell: WIN,
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function readEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      const v = m[2].replace(/^["']|["']$/g, "").trim();
      if (v) out[m[1]] = v;
    }
  }
  return out;
}

console.log(`\n${bold("Deploying Tarang")}\n`);

// --- 1. keys ----------------------------------------------------------------
const env = readEnvLocal();
if (!env.GEMINI_API_KEY) {
  console.log(`  ${yellow("No GEMINI_API_KEY in .env.local.")}`);
  console.log(`  The site will deploy and work, but on the keyword fallback rather than the model.`);
  console.log(dim(`  Run ${bold("npm run setup")} first if you want the real thing.\n`));
} else {
  console.log(`  ${green("✓")} Found GEMINI_API_KEY ${dim("..." + env.GEMINI_API_KEY.slice(-4))}`);
  if (env.NEXT_PUBLIC_VAPI_PUBLIC_KEY) console.log(`  ${green("✓")} Found NEXT_PUBLIC_VAPI_PUBLIC_KEY`);
  console.log("");
}

// --- 2. auth ----------------------------------------------------------------
const who = run(["whoami"], { quiet: true });
if (who.code !== 0) {
  console.log(bold("  Signing in to Vercel."));
  console.log(`  A browser tab will open. Choose ${bold("Continue with GitHub")} (or any option) and come back.`);
  console.log(dim("  Vercel's Hobby plan is free and needs no card.\n"));

  const login = run(["login"]);
  if (login.code !== 0) {
    console.log(`\n  ${red("Sign-in failed.")} Run ${bold("npx vercel login")} on its own, then ${bold("npm run deploy")} again.\n`);
    process.exit(1);
  }
  console.log("");
} else {
  console.log(`  ${green("✓")} Signed in to Vercel as ${who.out.trim()}\n`);
}

// --- 3. link ----------------------------------------------------------------
console.log(bold("  Linking the project…"));
const link = run(["link", "--yes"]);
if (link.code !== 0) {
  console.log(`\n  ${red("Could not link the project.")} Run ${bold("npx vercel link")} by hand and answer its prompts, then re-run this.\n`);
  process.exit(1);
}
console.log(`  ${green("✓")} Linked\n`);

// --- 4. environment ---------------------------------------------------------
const names = Object.keys(env).filter((k) => k === "GEMINI_API_KEY" || k === "TARANG_MODEL" || k.startsWith("NEXT_PUBLIC_"));

if (names.length) {
  console.log(bold("  Copying keys into the Vercel project…"));
  for (const name of names) {
    for (const target of ["production", "preview", "development"]) {
      // Adding an existing variable errors, so clear it first. A miss here is
      // expected and harmless on the first deploy.
      runWithInput(["env", "rm", name, target, "--yes"], "");
      const add = runWithInput(["env", "add", name, target], env[name] + "\n");
      if (add.code !== 0 && target === "production") {
        console.log(`  ${yellow("!")} Could not set ${name}. Add it by hand:`);
        console.log(dim(`     Vercel dashboard → your project → Settings → Environment Variables\n`));
      }
    }
    console.log(`  ${green("✓")} ${name}`);
  }
  console.log("");
}

// --- 5. ship ----------------------------------------------------------------
console.log(bold("  Building and deploying…"));
console.log(dim("  First deploy takes 2-3 minutes.\n"));

const deploy = spawnSync("npx", ["--yes", "vercel", "--prod", "--yes"], {
  cwd: ROOT,
  stdio: ["inherit", "pipe", "inherit"],
  shell: WIN,
  encoding: "utf8",
});

const url = (deploy.stdout ?? "").match(/https:\/\/[^\s]+\.vercel\.app/g)?.pop();

if (deploy.status !== 0) {
  console.log(`\n  ${red("Deploy failed.")} The build log above says why.`);
  console.log(dim(`  Re-run with ${bold("npm run deploy")} once it is fixed.\n`));
  process.exit(1);
}

console.log(`\n  ${green("✓ Live")}  ${bold(url ?? "check the URL printed above")}\n`);
console.log(dim("  That link is the one to send. Re-run npm run deploy any time to update it.\n"));
