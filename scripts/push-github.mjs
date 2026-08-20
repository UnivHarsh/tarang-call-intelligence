/**
 * Publishes the repo to GitHub.
 *
 *   npm run github
 *
 * Uses the GitHub CLI if it happens to be installed (it can create the repo
 * for you). Otherwise it walks you through creating an empty repo in the
 * browser and pushes to it — Git Credential Manager ships with Git for Windows
 * and handles the sign-in, so there is nothing to install either way.
 *
 * Afterwards it records the repo URL in .env.local as NEXT_PUBLIC_REPO_URL, so
 * the deployed site shows a "Source" link in its header.
 *
 * Safe to re-run: if a remote already exists it just pushes.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const WIN = process.platform === "win32";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const git = (args, opts = {}) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: "pipe", ...opts });
const gitLoud = (args) => spawnSync("git", args, { cwd: ROOT, stdio: "inherit" });

function hasGh() {
  const r = spawnSync("gh", ["--version"], { stdio: "pipe", shell: WIN, encoding: "utf8" });
  return r.status === 0;
}

function ghAuthed() {
  const r = spawnSync("gh", ["auth", "status"], { stdio: "pipe", shell: WIN, encoding: "utf8" });
  return r.status === 0;
}

function upsertEnv(key, value) {
  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push("", `# Shows a Source link in the site header.`, `${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"));
}

console.log(`\n${bold("Publishing to GitHub")}\n`);

// --- 0. sanity --------------------------------------------------------------
if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  console.log(`  ${red("Not a git repository.")} Something is off — expected .git in the project root.\n`);
  process.exit(1);
}

// Git refuses to commit without an identity. Set it on this repo only, rather
// than reaching into the user's global config.
let author = git(["config", "user.name"]).stdout.trim();

if (!git(["config", "user.email"]).stdout.trim()) {
  const rl0 = readline.createInterface({ input, output });
  console.log("  Git needs a name and email to attribute commits.");
  author = (await rl0.question("  Your name: ")).trim() || "Tarang";
  const email = (await rl0.question("  Your email: ")).trim() || "noreply@example.com";
  rl0.close();
  git(["config", "user.name", author]);
  git(["config", "user.email", email]);
  console.log(`  ${green("✓")} Set for this repo only ${dim("(your global git config is untouched)")}\n`);
}

// A public portfolio repo with no licence is ambiguous about whether anyone may
// read, run or borrow from it. Written from the name above rather than guessed.
const LICENSE_PATH = path.join(ROOT, "LICENSE");
if (!fs.existsSync(LICENSE_PATH) && author) {
  fs.writeFileSync(
    LICENSE_PATH,
    `MIT License

Copyright (c) 2026 ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  );
  console.log(`  ${green("✓")} Added an MIT LICENSE in your name\n`);
}

// GitHub's default branch is main; this repo was created as master.
if (git(["branch", "--show-current"]).stdout.trim() === "master") {
  git(["branch", "-M", "main"]);
  console.log(`  ${green("✓")} Renamed branch master → main\n`);
}

// Commit anything outstanding so the push is complete.
if (git(["status", "--porcelain"]).stdout.trim()) {
  console.log("  Committing uncommitted changes…");
  git(["add", "-A"]);
  git(["commit", "-m", "Update"]);
  console.log(`  ${green("✓")} Committed\n`);
}

// --- 1. remote --------------------------------------------------------------
let remote = git(["remote", "get-url", "origin"]).stdout.trim();

if (remote) {
  console.log(`  ${green("✓")} Remote already set: ${dim(remote)}\n`);
} else if (hasGh() && ghAuthed()) {
  console.log("  GitHub CLI found — creating the repo for you.\n");
  const r = spawnSync(
    "gh",
    ["repo", "create", "tarang-call-intelligence", "--public", "--source=.", "--remote=origin", "--push"],
    { cwd: ROOT, stdio: "inherit", shell: WIN },
  );
  if (r.status !== 0) {
    console.log(`\n  ${red("gh could not create the repo.")} Re-run and use the manual path, or check gh auth status.\n`);
    process.exit(1);
  }
  remote = git(["remote", "get-url", "origin"]).stdout.trim();
} else {
  console.log(bold("  Create the empty repo (about 30 seconds):\n"));
  console.log(`    1. Open ${bold("https://github.com/new")}`);
  console.log(`    2. Repository name: ${bold("tarang-call-intelligence")}`);
  console.log(`    3. Keep it ${bold("Public")} — the whole point is that people can read the code`);
  console.log(`    4. ${bold("Do not")} tick "Add a README", .gitignore or a license — this repo already has them`);
  console.log(`    5. Click ${bold("Create repository")}\n`);
  console.log(dim("  GitHub then shows you a URL like https://github.com/you/tarang-call-intelligence.git\n"));

  const rl = readline.createInterface({ input, output });
  const url = (await rl.question("  Paste that URL here: ")).trim();
  rl.close();

  if (!url) {
    console.log(`\n  ${yellow("Nothing pasted.")} Run ${bold("npm run github")} again when the repo exists.\n`);
    process.exit(0);
  }
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url) && !/^git@github\.com:/.test(url)) {
    console.log(`\n  ${red("That does not look like a GitHub repo URL.")}\n`);
    process.exit(1);
  }

  git(["remote", "add", "origin", url]);
  remote = url;
  console.log(`\n  ${green("✓")} Remote set\n`);
}

// --- 2. push ----------------------------------------------------------------
console.log(bold("  Pushing…"));
console.log(dim("  A browser window may open to sign in to GitHub. That is Git Credential Manager,\n  it only happens once, and it stores the token for future pushes.\n"));

const push = gitLoud(["push", "-u", "origin", "main"]);
if (push.status !== 0) {
  console.log(`\n  ${red("Push failed.")} The message above says why. Common causes:\n`);
  console.log("    • The repo was created with a README — run: git pull --rebase origin main, then npm run github");
  console.log("    • Sign-in was cancelled — just run npm run github again\n");
  process.exit(1);
}

// --- 3. wire the Source link ------------------------------------------------
const webUrl = remote.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
upsertEnv("NEXT_PUBLIC_REPO_URL", webUrl);

console.log(`\n  ${green("✓ Published")}  ${bold(webUrl)}\n`);
console.log(`  ${green("✓")} Recorded as NEXT_PUBLIC_REPO_URL, so the site header will link to the code.\n`);
console.log(`  Next:  ${bold("npm run deploy")}  ${dim("— ships it and picks up that link")}\n`);
