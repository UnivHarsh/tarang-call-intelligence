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

## Running it

```bash
npm install
npm run setup
```

`setup` asks for one thing — a Gemini API key — then writes `.env.local`, proves the key works against the real API, and runs the accuracy eval so the table on the **How it works** page holds measured numbers instead of a placeholder.

The key is free from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). A Google account is all it needs: no credit card, no billing setup, no subscription. (Note that Google AI Pro is a consumer chat plan and does *not* include API access — the API free tier is a separate, free thing.) The whole project fits inside that free tier.

You can also skip setup entirely. With no key, extraction falls back to a keyword rules engine that is clearly labelled as such, and every screen still works — the point is that a reviewer sees the real flow rather than a "configure your credentials" screen.

```bash
npm run dev      # http://localhost:3000
npm run deploy   # ship it and get a public URL
```

`deploy` signs you into Vercel if needed, creates the project, copies the keys from `.env.local` into it, and ships a production build. Every step prints the plain `vercel ...` command before running it, so a failure always tells you what to finish by hand.

| Command | What it does |
|---|---|
| `npm run setup` | Key → `.env.local` → verify → eval |
| `npm run dev` | Local dev server |
| `npm run deploy` | Vercel deploy with env vars configured |
| `npm run check-key` | One call to Gemini; says exactly what is broken if anything is |
| `npm run eval` | Re-run the accuracy eval (starts its own server if needed) |
| `npm run corpus` | Regenerate the 933-call corpus from seed |

### The optional bit: a working microphone

The voice demo needs a [Vapi](https://vapi.ai) account — free starting credit, and the assistant config already lives in [`src/lib/vapi-assistant.ts`](src/lib/vapi-assistant.ts), so there is nothing to build in their dashboard. Copy the **public** key from their dashboard into `.env.local` as `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and re-run `npm run deploy`.

Without it, **Live demo** still runs the full pipeline through *Replay a sample call* and *Paste a transcript*.

## Architecture

```
browser mic ──▶ Vapi ──▶ transcript ──▶ /api/extract ──▶ CallInsight ──▶ dashboard
                (agent + STT)           (one Gemini pass,      (fixed schema)
                                         schema-constrained)
                                                 │
                                                 └── rules-engine fallback when no key
```

Everything except one model call per call is deterministic code. The aggregation, the spike detection and the significance testing all run in TypeScript — the model is never asked to do arithmetic over 933 records, only to read one conversation at a time.

**Key files**

| Path | What lives there |
|---|---|
| [`src/lib/types.ts`](src/lib/types.ts) | The `CallInsight` schema — the contract everything else reads |
| [`src/lib/prompt.ts`](src/lib/prompt.ts) | The extraction system prompt and the JSON output schema |
| [`src/lib/analytics.ts`](src/lib/analytics.ts) | Bucketing, KPIs, the two-proportion z-test, signal clustering |
| [`src/lib/extract-local.ts`](src/lib/extract-local.ts) | The keyword baseline — keyless fallback and eval control |
| [`src/components/charts.tsx`](src/components/charts.tsx) | Hand-rolled SVG charts |
| [`scripts/generate-corpus.mjs`](scripts/generate-corpus.mjs) | Deterministic corpus generator |
| [`scripts/eval-extraction.mjs`](scripts/eval-extraction.mjs) | Eval harness |
| [`scripts/check-key.mjs`](scripts/check-key.mjs) | One-call diagnostic for the Gemini key |

## The corpus is also a test set

`npm run corpus` regenerates all 933 calls from a fixed seed — same bytes on any machine. Because the generator authors the ground-truth insight fields alongside the transcript, every call is a labelled example for free.

The harness re-extracts a fixed stratified slice through the real API route and scores field-level agreement against ground truth **and** against the keyword baseline:

```bash
npm run eval
```

It reuses a dev server if one is running and otherwise starts and stops its own, so it really is one command.

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

`npm run deploy` handles it. If you would rather do it by hand: push to GitHub, import the repo at [vercel.com](https://vercel.com), and add `GEMINI_API_KEY` under Settings → Environment Variables. No build configuration is needed — the build regenerates the corpus from seed rather than trusting the copy in the repo.

## Honest limitations

The calls are synthetic. The language is more consistent than real speech and the ground truth is unrealistically clean, so the eval numbers are a ceiling rather than an estimate. Speech-to-text on code-mixed Hindi and English — especially order numbers over a phone line — is the weak link, not the reasoning. Predicted CSAT has never been checked against a real survey. Live calls are stored in your browser, not a database. And note that Google's free API tier may use submitted content to improve their models, which is fine for a fictional company's synthetic calls and would not be for real customer audio.

The **How it works** page spells all of this out in more detail, including what I would build next.

---

Built with Next.js, TypeScript, the Gemini API and Vapi. Kartly is fictional and no real customer data is used anywhere in this project.
