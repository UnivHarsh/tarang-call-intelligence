# Tarang — call intelligence

**A working prototype: a voice agent takes customer support calls, and every call comes back as a structured record you can aggregate, filter and question.**

Live: _(add your deployment URL here)_

---

## What it is

Support calls are the highest-density source of product truth most companies own, and almost nobody reads them. A team listens to maybe 2% as a QA sample, writes a few tickets, and the other 98% evaporates.

This is an end-to-end attempt at the other approach: read all of them, turn each into a fixed schema, and see what falls out.

The demo runs on **Kartly**, a fictional D2C grocery and household retailer in India, with a corpus of **933 synthetic support calls** across eight weeks. The calls are code-mixed Hinglish, English and Hindi, because that is what support in India actually sounds like.

Three problems are buried in the data and are never labelled as such. The dashboard finds them on its own:

- a cold-chain failure that starts in the monsoon weeks and concentrates in the west and south
- a coupon that silently fails on Android at checkout
- a courier handover in Delhi that broke for three weeks and then recovered

Overall predicted CSAT stays flat across all eight weeks. That is deliberate — it is the case that makes segment analysis worth building, because the headline number tells you nothing is wrong.

## What it does

| Page | What it is for |
|---|---|
| **Overview** | Headline metrics, what changed in the last two weeks (with a significance test), volume by root cause, and a normalised city heatmap |
| **Signals** | Product signals clustered across calls — the handful of things somebody could actually go and fix |
| **Calls** | All 933 calls, filterable, with the full extracted record and transcript per call |
| **Live demo** | Talk to the agent, or replay a call, or paste a transcript — all three run the same extraction |
| **Ask** | Plain-English questions over the corpus, answered with citations to individual calls |
| **How it works** | Architecture, the actual prompt and schema, unit economics, the eval, and what I would not claim |

## Try it without setting anything up

Every path works with zero credentials. With no API key the extraction falls back to a keyword rules engine, clearly labelled as such — the point is that a reviewer sees the real flow rather than a "configure your credentials" screen.

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. On **Live demo**, hit **Replay a sample call** — a real transcript streams in and goes through the extraction pipeline exactly as a live call would.

## Turning on the real thing

Copy `.env.example` to `.env.local` and fill in what you have. Every variable is optional and each one lights up a different part independently.

```bash
# Voice — the public key is meant to be in the browser bundle.
NEXT_PUBLIC_VAPI_PUBLIC_KEY=pk_...

# Extraction — server-side only, never reaches the client.
ANTHROPIC_API_KEY=sk-ant-...
```

- **Vapi public key** → the microphone path turns on. The assistant config lives in [`src/lib/vapi-assistant.ts`](src/lib/vapi-assistant.ts) and is passed inline, so you do not need to create an assistant in their dashboard. Vapi's free tier is enough for a demo.
- **Anthropic key** → real extraction and real Ask answers, instead of the rules engine and the pre-computed aggregates.

`GET /api/health` reports which of these a deployment actually has, without revealing anything.

## Architecture

```
browser mic ──▶ Vapi ──▶ transcript ──▶ /api/extract ──▶ CallInsight ──▶ dashboard
                (agent + STT)              (one LLM pass,      (fixed schema)
                                            strict schema)
                                                 │
                                                 └── rules-engine fallback when no key
```

Everything except one model call per call is deterministic code. The aggregation, the spike detection and the significance testing all run in TypeScript — the model is never asked to do arithmetic over 933 records, only to read one conversation at a time.

**Key files**

| Path | What lives there |
|---|---|
| [`src/lib/types.ts`](src/lib/types.ts) | The `CallInsight` schema — the contract everything else reads |
| [`src/lib/prompt.ts`](src/lib/prompt.ts) | The extraction system prompt and the strict tool schema |
| [`src/lib/analytics.ts`](src/lib/analytics.ts) | Bucketing, KPIs, the two-proportion z-test, signal clustering |
| [`src/lib/extract-local.ts`](src/lib/extract-local.ts) | The keyword baseline — keyless fallback and eval control |
| [`src/components/charts.tsx`](src/components/charts.tsx) | Hand-rolled SVG charts |
| [`scripts/generate-corpus.mjs`](scripts/generate-corpus.mjs) | Deterministic corpus generator |
| [`scripts/eval-extraction.mjs`](scripts/eval-extraction.mjs) | Eval harness |

## The corpus is also a test set

`npm run corpus` regenerates all 933 calls from a fixed seed — same bytes on any machine. Because the generator authors the ground-truth insight fields alongside the transcript, every call is a labelled example for free.

The harness re-extracts a fixed stratified slice through the real API route and scores field-level agreement against ground truth **and** against the keyword baseline:

```bash
npm run dev   # in one terminal, with ANTHROPIC_API_KEY set
npm run eval  # in another
```

It writes `public/data/eval-results.json`, and the How it works page renders the table automatically. Scoring against a baseline rather than against chance is the whole point: "91% on intent" means little until you know regexes get 62%.

## Some decisions worth arguing with

- **Intent and root cause are separate fields.** Intent is what the customer asked for; root cause is which team owns the fix. Most taxonomies collapse them, which is why most "top issues" dashboards cannot name an owner.
- **Spike detection compares rates, not counts, and runs a z-test.** Call volume grows week over week here, so raw counts would flag everything as rising. Anything below z ≈ 2.5 is dropped, and the z-score stays visible in the UI.
- **The panel shows what got better too.** Same test, reversed. A dashboard that only reports regressions teaches people that nothing they do helps.
- **A product signal is usually null.** The prompt says so explicitly, and the rules engine never raises one at all — deciding that one complaint generalises is a judgement, and a keyword match is not one.
- **Heatmap cells under 8 calls are not coloured in.** A city-week with four calls reads 25% off a single call, which would make the emptiest tiles the brightest ones.
- **Charts are hand-rolled SVG.** Not for the sake of it — it was the way to hold the palette to a colourblind-safe categorical order and validate it, rather than accept a chart library's defaults. Both light and dark palettes pass adjacent-pair CVD separation; the stacked chart carries a table view because three light-mode steps sit under 3:1 against the surface.

There is a longer version of this list, with the reasoning, on the **How it works** page.

## Deploying

The app is a standard Next.js project and deploys to Vercel with no configuration.

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com), **Add New → Project**, and import the repo.
3. Add `ANTHROPIC_API_KEY` and `NEXT_PUBLIC_VAPI_PUBLIC_KEY` under **Settings → Environment Variables** (both optional — it deploys fine without them).
4. Deploy.

The build runs `npm run corpus` first, so the data is regenerated from seed at build time rather than trusted from the repo.

## Honest limitations

The calls are synthetic. The language is more consistent than real speech and the ground truth is unrealistically clean, so the eval numbers are a ceiling rather than an estimate. Speech-to-text on code-mixed Hindi and English — especially order numbers over a phone line — is the weak link, not the reasoning. Predicted CSAT has never been checked against a real survey. Live calls are stored in your browser, not a database.

The **How it works** page spells all of this out in more detail, including what I would build next.

---

Built with Next.js, TypeScript, the Anthropic API and Vapi. Kartly is fictional and no real customer data is used anywhere in this project.
