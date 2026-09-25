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
| **Live demo** | Actually talk to the agent out loud, or replay a call, or paste a transcript — all three run the same extraction |
| **Ask** | Plain-English questions over the corpus, answered with citations to individual calls |
| **Speech accuracy** | Word error rate across three recognition setups, and how much of it is the scoring convention rather than the recogniser |
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
npm run github   # publish the code
npm run deploy   # ship it and get a public URL
```

`github` renames the branch to `main`, writes an MIT licence in your name, walks you through creating the empty repo, pushes, and records the repo URL so the deployed site carries a **Source** link back to the code. It uses the GitHub CLI if you have it and the browser if you do not.

`deploy` signs you into Vercel if needed, creates the project, copies the keys from `.env.local` into it, and ships a production build. Every step prints the plain `vercel ...` command before running it, so a failure always tells you what to finish by hand.

| Command | What it does |
|---|---|
| `npm run setup` | Key → `.env.local` → verify → eval |
| `npm run github` | Licence, branch, repo, push, Source link |
| `npm run deploy` | Vercel deploy with env vars configured |
| `npm run dev` | Local dev server |
| `npm run check-key` | One call to Gemini; says exactly what is broken if anything is |
| `npm run eval` | Re-run the accuracy eval (starts its own server if needed) |
| `npm run corpus` | Regenerate the 933-call corpus from seed |

### The voice

The same Gemini key powers the microphone. On **Live demo**, press the call button and you are in a real conversation — Maya answers out loud in Hinglish, and if you talk over her she stops mid-sentence like a person would.

It is built as a call, not a widget: avatar, ringing state, a running duration, a waveform driven by the actual audio signal on both sides, mute, and a red hang-up. During a call there is exactly one thing on screen; the transcript and the extracted record appear after you hang up.

Your mic is captured as raw 16 kHz PCM in an `AudioWorklet`, streamed over a WebSocket straight to the Gemini Live API; her audio comes back at 24 kHz and is scheduled back-to-back so it does not stutter. Both sides are transcribed by the API, which is what becomes the call record. The browser never sees the API key — [`/api/voice-token`](src/app/api/voice-token/route.ts) mints a single-use token that expires in minutes.

`npm run check-key` verifies the voice model separately from the extraction model, because they are different models and can fail independently.

**Optional — real telephony.** The same agent prompt also configures a [Vapi](https://vapi.ai) assistant ([`src/lib/vapi-assistant.ts`](src/lib/vapi-assistant.ts)) if you want an actual phone number people can ring. Add `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and a second button appears. One prompt, two transports.

## Architecture

```
browser mic ──▶ Gemini Live ──▶ transcript ──▶ /api/extract ──▶ CallInsight ──▶ dashboard
   16 kHz PCM    speaks back,                  (one Gemini pass,     (fixed schema)
   over WS       transcribes both sides         schema-constrained)
                                                        │
                                                        └── rules fallback when no key
```

Everything except one model call per call is deterministic code. The aggregation, the spike detection and the significance testing all run in TypeScript — the model is never asked to do arithmetic over 933 records, only to read one conversation at a time.

**Key files**

| Path | What lives there |
|---|---|
| [`src/lib/types.ts`](src/lib/types.ts) | The `CallInsight` schema — the contract everything else reads |
| [`src/lib/prompt.ts`](src/lib/prompt.ts) | The extraction system prompt and the JSON output schema |
| [`src/lib/analytics.ts`](src/lib/analytics.ts) | Bucketing, KPIs, the two-proportion z-test, signal clustering |
| [`src/lib/extract-local.ts`](src/lib/extract-local.ts) | The keyword baseline — keyless fallback and eval control |
| [`src/lib/live-voice.ts`](src/lib/live-voice.ts) | Real-time voice: mic capture, streaming, playback, turn assembly |
| [`src/lib/voice-agent.ts`](src/lib/voice-agent.ts) | The agent's prompt, shared by both voice transports |
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

## How wrong is the transcript?

Every page except one treats the transcript as a given. It is not. It is a model
output, and on code-mixed Hindi and English it is the weakest link in the chain.
The **Speech accuracy** page measures it.

```bash
npm run asr
```

Lines are taken from the corpus, where the exact words are already known, spoken
by a text-to-speech model, and sent as identical audio to three recognition
setups. All three use the same model with the same decoding settings. Only the
instruction changes, so any difference in the table is attributable to the prompt
and to nothing else. The third arm asks for Devanagari on purpose: it is not a
setup anyone would ship, it is the control.

**Word error rate on Indic speech is partly a statement about your scoring
convention.** A perfectly correct transcript written in Devanagari, scored
against a Roman reference, is 100% wrong. So every pair is scored eight times,
adding one normalisation at a time — case, punctuation, script, Hinglish spelling
variants, spoken numbers, order ids, fillers — and the report shows the rate at
each step. A line that falls steeply was never failing at recognition. A line
that stays flat is the honest error.

Two things worth knowing about the numbers. The audio is synthetic, so it has
none of the noise, codec loss or overlapping speech of a phone line and every
rate is a floor rather than an estimate. And the first run of this benchmark
reported error rates above 300%, because the text-to-speech model was handed the
instruction along with the line and read the instruction out loud. A rate that
absurd is a bug report, not a finding; it was caught by reading the transcripts
rather than trusting the metric.

## Some decisions worth arguing with

- **Intent and root cause are separate fields.** Intent is what the customer asked for; root cause is which team owns the fix. Most taxonomies collapse them, which is why most "top issues" dashboards cannot name an owner.
- **Spike detection compares rates, not counts, and runs a z-test.** Call volume grows week over week here, so raw counts would flag everything as rising. Anything below z ≈ 2.5 is dropped, and the z-score stays visible in the UI.
- **The panel shows what got better too.** Same test, reversed. A dashboard that only reports regressions teaches people that nothing they do helps.
- **A product signal is usually null.** The prompt says so explicitly, and the rules engine never raises one at all — deciding that one complaint generalises is a judgement, and a keyword match is not one.
- **Heatmap cells under 8 calls are not coloured in.** A city-week with four calls reads 25% off a single call, which would make the emptiest tiles the brightest ones.
- **Charts are hand-rolled SVG.** Not for the sake of it — it was the way to hold the palette to a colourblind-safe categorical order and validate it, rather than accept a chart library's defaults. Both light and dark palettes pass adjacent-pair CVD separation; the stacked chart carries a table view because three light-mode steps sit under 3:1 against the surface.

There is a longer version of this list, with the reasoning, on the **How it works** page.

## Publishing and deploying

`npm run github` then `npm run deploy`. By hand it is the same thing: create a repo, push, import it at [vercel.com](https://vercel.com), and add `GEMINI_API_KEY` under Settings → Environment Variables. No build configuration is needed — the build regenerates the corpus from seed rather than trusting the copy in the repo.

## Honest limitations

The calls are synthetic. The language is more consistent than real speech and the ground truth is unrealistically clean, so the eval numbers are a ceiling rather than an estimate. Speech-to-text on code-mixed Hindi and English — especially order numbers over a phone line — is the weak link, not the reasoning. Predicted CSAT has never been checked against a real survey. Live calls are stored in your browser, not a database. And note that Google's free API tier may use submitted content to improve their models, which is fine for a fictional company's synthetic calls and would not be for real customer audio.

The **How it works** page spells all of this out in more detail, including what I would build next.

---

Built with Next.js, TypeScript and the Gemini API (Live for voice, Flash for extraction). Kartly is fictional and no real customer data is used anywhere in this project.
