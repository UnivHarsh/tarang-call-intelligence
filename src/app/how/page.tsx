"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EXTRACTION_SCHEMA, SYSTEM_PROMPT, MODEL_RATES, DEFAULT_MODEL, FREE_TIER_NOTE } from "@/lib/prompt";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/vapi-assistant";
import { useStore } from "@/lib/store";

interface EvalResults {
  ranAt: string;
  model: string;
  servedBy?: Record<string, number>;
  n: number;
  fields: { field: string; llm: number; rules: number }[];
  meanLatencyMs: number;
  meanCostUsd: number;
  notes?: string[];
}

function Architecture() {
  return (
    <div className="scroll-x">
      <svg viewBox="0 0 900 260" style={{ width: "100%", minWidth: 700, height: "auto" }} role="img" aria-label="System architecture">
        <defs>
          <marker id="arw" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" fill="var(--axis)" />
          </marker>
        </defs>

        {[
          { x: 8, label: "Caller", sub: "mic → 16 kHz PCM", tone: "var(--text-muted)" },
          { x: 186, label: "Gemini Live", sub: "speaks + transcribes", tone: "var(--series-1)" },
          { x: 364, label: "/api/extract", sub: "one LLM pass", tone: "var(--series-1)" },
          { x: 542, label: "Call record", sub: "fixed schema", tone: "var(--series-3)" },
          { x: 720, label: "Dashboard", sub: "aggregate + ask", tone: "var(--series-3)" },
        ].map((b, i) => (
          <g key={b.label}>
            <rect x={b.x} y={54} width={172} height={62} rx={9} fill="var(--surface-2)" stroke="var(--border-strong)" />
            <text x={b.x + 86} y={80} textAnchor="middle" style={{ fontSize: 14, fontWeight: 620, fill: "var(--text-primary)" }}>
              {b.label}
            </text>
            <text x={b.x + 86} y={99} textAnchor="middle" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
              {b.sub}
            </text>
            {i < 4 && <line x1={b.x + 174} y1={85} x2={b.x + 184} y2={85} stroke="var(--axis)" strokeWidth={1.5} markerEnd="url(#arw)" />}
          </g>
        ))}

        <rect x={364} y={148} width={172} height={54} rx={9} fill="transparent" stroke="var(--grid)" strokeDasharray="3 3" />
        <text x={450} y={170} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 600, fill: "var(--text-secondary)" }}>
          rules-engine fallback
        </text>
        <text x={450} y={187} textAnchor="middle" style={{ fontSize: 10.5, fill: "var(--text-muted)" }}>
          used when no key is set
        </text>
        <line x1={450} y1={118} x2={450} y2={146} stroke="var(--grid)" strokeWidth={1.5} strokeDasharray="3 3" markerEnd="url(#arw)" />

        <text x={8} y={232} style={{ fontSize: 11, fill: "var(--text-muted)" }}>
          The API key never leaves the server. The browser holds only a single-use token, minted per call and expiring in minutes.
        </text>
      </svg>
    </div>
  );
}

function Decision({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 0" }}>
      <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

/** Two columns on wide screens: the prose is capped at a readable measure, so a
 *  single column leaves half the card empty on a desktop. */
function Decisions({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", columnGap: 34, rowGap: 0, marginTop: 6 }}
    >
      {children}
    </div>
  );
}

export default function HowPage() {
  const { meta } = useStore();
  const [evals, setEvals] = useState<EvalResults | null>(null);
  const [showSchema, setShowSchema] = useState(false);

  useEffect(() => {
    fetch("/data/eval-results.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setEvals)
      .catch(() => setEvals(null));
  }, []);

  // Measured from the corpus rather than asserted. ~24 tokens per turn is the
  // observed average for these code-mixed transcripts; the constant is the
  // system prompt and schema, which are the same on every call.
  const avgTurns = meta?.totalCalls ? Math.round(meta.totalTurns / meta.totalCalls) : 14;
  const estInputTokens = Math.round(avgTurns * 24 + 900);
  const estOutputTokens = 520;

  return (
    <>
      <section style={{ padding: "30px 0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>How it works</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "74ch" }}>
          The interesting part of this project is not that an LLM can read a transcript — it obviously can. It is
          everything around that: deciding what to extract, keeping the output trustworthy enough to aggregate, and
          knowing which numbers on the dashboard are earned and which are estimates.
        </p>
      </section>

      {/*
        A first-time visitor lands here with no idea which of six pages to open.
        Four lines up front beat a perfect architecture diagram they never scroll to.
      */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Using this in sixty seconds</div>
        <p className="card-sub">Four steps, in the order they are meant to be taken.</p>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginTop: 12 }}
        >
          {[
            { n: 1, to: "/", label: "Overview", say: "Start with the three signals at the top. They are what reading every call found that nobody had filed." },
            { n: 2, to: "/signals", label: "Signals", say: "Open one. Every signal names an owning team and lists the calls behind it, so it can be handed over as-is." },
            { n: 3, to: "/calls", label: "Calls", say: "Click any call to see the full transcript next to the record extracted from it. The evidence is never more than one click away." },
            { n: 4, to: "/ask", label: "Ask", say: "Ask the corpus a question in plain English. Answers cite the individual calls they came from." },
          ].map((s) => (
            <Link
              key={s.n}
              href={s.to}
              className="card"
              style={{ display: "block", textDecoration: "none", color: "inherit", padding: "13px 15px", margin: 0 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    width: 20, height: 20, borderRadius: 6, background: "var(--series-1)", color: "var(--plane)",
                    fontSize: 11.5, fontWeight: 700, display: "grid", placeItems: "center", flex: "none",
                  }}
                >
                  {s.n}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 620 }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{s.say}</div>
            </Link>
          ))}
        </div>
        <p className="card-sub" style={{ marginTop: 12 }}>
          Two more worth a look: <Link href="/live">Live demo</Link> to talk to the agent yourself, and{" "}
          <Link href="/asr">Speech accuracy</Link> for how wrong the transcripts underneath all of this actually are.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Architecture</div>
        <p className="card-sub">Five stages. Everything after the second one is deterministic code except a single model call.</p>
        <Architecture />
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">The design decisions that actually mattered</div>
        <p className="card-sub">Each of these changed what the dashboard says, not just how it looks.</p>

        <Decisions>
        <Decision title="Intent and root cause are separate fields">
          Intent is what the customer asked for. Root cause is what went wrong, and therefore which team owns the fix.
          Almost every support taxonomy collapses these into one field, and that is why &ldquo;top issues&rdquo; dashboards are
          useful to a CS lead and useless to anyone else. &ldquo;Where is my order&rdquo; is one intent with two completely
          different owners depending on whether the order was actually late or the promise was wrong. Splitting them is
          what lets the emerging-issues panel name an owner for every row.
        </Decision>

        <Decision title="Spike detection compares rates, and runs a significance test">
          Call volume grows week over week in this corpus. If the detector compared raw counts, every category would look
          like it was rising. So it compares each segment as a share of that window&rsquo;s calls, then runs a
          two-proportion z-test and discards anything below z ≈ 2.5. That single filter is the difference between a panel
          that surfaces two real problems and one that surfaces thirty, of which two are real. The z-score stays visible
          in the UI so the reader can judge for themselves.
        </Decision>

        <Decision title="The tool shows what is getting better, not only what is getting worse">
          The same test run in reverse. A team that fixed something deserves to see it, and a dashboard that only ever
          reports regressions quietly teaches its readers that nothing they do helps. In this corpus it catches a
          logistics problem in Delhi that was real for three weeks and then recovered.
        </Decision>

        <Decision title="Predicted CSAT, not surveyed CSAT">
          A post-call survey is answered by roughly one caller in twelve, and the ones who answer are the angriest and the
          happiest. Predicting a score for every call trades precision for coverage — the absolute number is softer than
          a survey, but it is comparable across segments, which is the thing you actually want it for. It is labelled
          &ldquo;predicted&rdquo; everywhere it appears for exactly that reason.
        </Decision>

        <Decision title="A product signal is usually null, and the prompt says so out loud">
          The tempting failure mode is a model that finds a profound systemic insight in every routine call. The prompt
          explicitly says that null is the common and correct answer, and the rules-engine fallback never raises a signal
          at all — deciding that one complaint generalises is a judgement, and a keyword match is not one. About a
          quarter of calls carry a signal, and they cluster into six distinct things.
        </Decision>

        <Decision title="Quotes are verbatim, including the code-mixing">
          Quotes are what a reader uses to decide whether to trust the rest of the record. A cleaned-up or translated
          quote destroys that, so the prompt forbids it. It also means the Hinglish survives into the UI, which is how
          the calls actually sound.
        </Decision>

        <Decision title="Cells with too few calls are not coloured in">
          A city-week holding four calls can read 25% off a single call. On a normalised heatmap those cells would be the
          brightest tiles on the map. Anything under eight calls renders as a dashed placeholder and is excluded from the
          colour scale, and cities that never clear the bar are dropped with a note rather than shown as a row of dashes.
        </Decision>

        <Decision title="Two payloads, not one">
          The corpus ships as an index of insight fields and a separate transcripts file. The dashboard never reads a
          transcript, and transcripts are about half the bytes, so loading them together would make the first chart wait
          on 1.5MB of text nobody has asked to read. Transcripts stream in behind first paint and are there by the time
          anyone opens a call.
        </Decision>
        </Decisions>
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">The extraction contract</div>
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setShowSchema((v) => !v)}>
            {showSchema ? "Show prompt" : "Show schema"}
          </button>
        </div>
        <p className="card-sub">
          This is rendered directly from the source file the API route imports, so what you are reading is what runs.
          Output is forced through a strict tool schema, which means the response either validates or the call fails —
          there is no JSON-parsing-with-regex step anywhere in this project.
        </p>
        <pre
          className="mono"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            padding: 16,
            borderRadius: 8,
            overflowX: "auto",
            fontSize: 11.5,
            lineHeight: 1.6,
            margin: 0,
            maxHeight: 460,
            whiteSpace: "pre-wrap",
          }}
        >
          {showSchema ? JSON.stringify(EXTRACTION_SCHEMA, null, 2) : SYSTEM_PROMPT}
        </pre>
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">The voice agent</div>
        <p className="card-sub">
          The browser opens a WebSocket straight to the Gemini Live API and streams raw 16 kHz PCM up; audio comes back
          at 24 kHz and is scheduled back-to-back so the speech is gapless. Barge-in works — interrupt her and the queued
          audio is dropped mid-sentence. The same prompt also drives an optional Vapi assistant for real telephony, so
          one agent definition covers both transports.
        </p>
        <pre
          className="mono"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            padding: 16,
            borderRadius: 8,
            overflowX: "auto",
            fontSize: 11.5,
            lineHeight: 1.6,
            margin: 0,
            maxHeight: 300,
            whiteSpace: "pre-wrap",
          }}
        >
          {ASSISTANT_SYSTEM_PROMPT}
        </pre>
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">What it costs to read a call</div>
        <p className="card-sub">
          A call in this corpus averages {avgTurns} turns, which is roughly {estInputTokens.toLocaleString("en-IN")} input
          tokens with the system prompt, and about {estOutputTokens} output tokens for the record. This project runs on
          Google AI Studio&rsquo;s free tier, so the real bill is zero — the paid rates below answer the question that
          matters once a prototype stops being one.
        </p>

        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Model</th>
                <th style={{ textAlign: "right" }}>$ / 1M in</th>
                <th style={{ textAlign: "right" }}>$ / 1M out</th>
                <th style={{ textAlign: "right" }}>Per call</th>
                <th style={{ textAlign: "right" }}>10,000 calls / month</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(MODEL_RATES).map(([id, r]) => {
                const per = (estInputTokens / 1e6) * r.in + (estOutputTokens / 1e6) * r.out;
                return (
                  <tr key={id} style={{ cursor: "default" }}>
                    <td>
                      {r.label}
                      {id === DEFAULT_MODEL && <span className="chip" style={{ marginLeft: 8 }}>default here</span>}
                      {r.free && (
                        <span className="chip" style={{ marginLeft: 6, color: "var(--delta-good)" }}>
                          free tier
                        </span>
                      )}
                      {r.note && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.note}</div>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>${r.in.toFixed(2)}</td>
                    <td className="num" style={{ textAlign: "right" }}>${r.out.toFixed(2)}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 620 }}>${per.toFixed(4)}</td>
                    <td className="num" style={{ textAlign: "right" }}>${(per * 10000).toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 14, maxWidth: "76ch" }}>
          {FREE_TIER_NOTE}
        </p>

        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10, maxWidth: "76ch" }}>
          For comparison, a human QA analyst reviewing calls to this depth manages roughly 10 to 14 an hour. At ₹350 an
          hour that is about ₹27 a call, against well under a rupee for the model — roughly two orders of magnitude, and
          closer to three on the Lite tier. The honest framing is not that it replaces the analyst. It is that 100% of
          calls get read instead of the 2% sample a team can afford, and the analyst&rsquo;s hour moves to the calls the
          model flagged.
        </p>
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">Does the extraction actually work?</div>
          {evals && <span className="chip">n = {evals.n}</span>}
        </div>
        <p className="card-sub">
          The corpus was generated from scripted scenarios, so every seeded call carries the ground-truth values it was
          built from. That makes it a labelled eval set for free. The harness re-extracts a fixed stratified slice with
          the real model and scores field-level agreement — against ground truth, and against the keyword rules engine as
          a baseline, because &ldquo;the model beats chance&rdquo; is a much weaker claim than &ldquo;the model beats the regexes
          anyone could write in an afternoon&rdquo;.
        </p>

        {evals ? (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th style={{ textAlign: "right" }}>Model</th>
                    <th style={{ textAlign: "right" }}>Rules baseline</th>
                    <th style={{ textAlign: "right" }}>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {evals.fields.map((f) => (
                    <tr key={f.field} style={{ cursor: "default" }}>
                      <td className="mono" style={{ fontSize: 12 }}>{f.field}</td>
                      <td className="num" style={{ textAlign: "right", fontWeight: 620 }}>{(f.llm * 100).toFixed(0)}%</td>
                      <td className="num" style={{ textAlign: "right", color: "var(--text-muted)" }}>{(f.rules * 100).toFixed(0)}%</td>
                      <td
                        className="num"
                        style={{ textAlign: "right", color: f.llm >= f.rules ? "var(--delta-good)" : "var(--critical)" }}
                      >
                        {f.llm >= f.rules ? "+" : ""}
                        {((f.llm - f.rules) * 100).toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
              Run on {evals.model} · mean latency {Math.round(evals.meanLatencyMs)}ms · mean cost $
              {evals.meanCostUsd.toFixed(4)} per call · {new Date(evals.ranAt).toDateString()}
            </div>
            {evals.notes?.map((n) => (
              <div key={n} style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 8 }}>
                {n}
              </div>
            ))}
          </>
        ) : (
          <div
            style={{
              background: "var(--surface-2)",
              border: "1px dashed var(--border-strong)",
              borderRadius: 8,
              padding: 16,
              fontSize: 12.5,
              color: "var(--text-secondary)",
            }}
          >
            <strong style={{ color: "var(--text-primary)" }}>Not run on this deployment.</strong> The harness needs an API
            key and costs a few cents, so it is a command rather than something that runs on every build. With a key set:
            <pre className="mono" style={{ margin: "10px 0 0", fontSize: 11.5 }}>npm run eval</pre>
            <div style={{ marginTop: 8 }}>
              It writes <code>public/data/eval-results.json</code> and this section fills itself in.
            </div>
          </div>
        )}

        {/*
          The question everyone asks about a project like this is "why the small
          model", and the honest answer turned out to be more interesting than the
          choice itself.
        */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Which model, and why it barely matters here</div>
          <p className="card-sub" style={{ maxWidth: "74ch", lineHeight: 1.6 }}>
            Flash-Lite is not a considered choice, it is the only one the free tier will sustain. The larger Flash model
            answers a single request and then returns <code>429 quota exceeded</code>, so a 45-call run cannot finish on
            it. The extraction route is built to fall back rather than fail, which is right for a user and wrong for a
            benchmark: an early run reported itself as Flash while every call had quietly landed on Flash-Lite. The eval
            now records which model actually served each call, and the table above names the one that served the most.
          </p>
          <p className="card-sub" style={{ maxWidth: "74ch", lineHeight: 1.6, marginTop: 8 }}>
            The result of chasing this: across three runs the model tier moved intent between 82% and 89% and root cause
            between 80% and 82%. The ceiling here is not the model. It is that two of the nine fields are categorical
            labels the corpus was generated from, which is a problem you fix by rewriting the labels or by using real
            calls, not by buying a bigger model.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">What I would not claim</div>
        <div className="prose" style={{ marginTop: 10 }}>
          <ul>
            <li>
              <strong>The calls are synthetic.</strong> They were generated from scripted scenarios, which means the
              language is more consistent than real speech and the ground truth is unrealistically clean. Real audio
              brings accents, crosstalk, background noise and callers who change their mind mid-sentence — the extraction
              would be measurably worse, and the eval numbers above are a ceiling rather than an estimate.
            </li>
            <li>
              <strong>Speech-to-text is the weak link, not the reasoning.</strong> Code-mixed Hindi and English is the
              hard case for every ASR system, and order numbers spoken over a phone line are the hardest part of that. The
              per-turn confidence shown in the transcript view is where I would spend the next week.
            </li>
            <li>
              <strong>Predicted CSAT has never been validated against a real survey.</strong> It is internally consistent
              and useful for comparing segments; calling it &ldquo;CSAT&rdquo; without the word &ldquo;predicted&rdquo; would be
              overclaiming.
            </li>
            <li>
              <strong>One model pass per call does not scale to real volume as written.</strong> At tens of thousands of
              calls a day this wants batching, and the Batch API halves the cost for work that is not latency-sensitive —
              which post-call analysis is not.
            </li>
            <li>
              <strong>Live calls in this demo live in your browser.</strong> There is no database. That is the right call
              for a prototype and the wrong one for anything real.
            </li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-title">What I would build next</div>
        <div className="prose" style={{ marginTop: 10 }}>
          <ul>
            <li>
              <strong>Close the loop.</strong> Right now a signal is a row on a page. It should open a ticket with the
              cited calls attached, and the panel should show whether the fix moved the rate.
            </li>
            <li>
              <strong>Proactive outreach.</strong> When a batch defect is confirmed, the customers who received that batch
              are already known. Reaching them before they call is worth more than handling the call well.
            </li>
            <li>
              <strong>Agent coaching from the compliance field.</strong> The checklist is already extracted per call; the
              missing piece is rolling it up per agent and per week.
            </li>
            <li>
              <strong>A human-labelled slice.</strong> Two hundred real calls labelled by hand would replace the synthetic
              ground truth and make every number on this page defensible.
            </li>
          </ul>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 24, maxWidth: "76ch" }}>
        Built with Next.js and TypeScript. Voice by Vapi, extraction by the Gemini API, charts hand-rolled in SVG so
        the colour palette could be held to a colourblind-safe categorical order. {meta?.brandNote}
      </p>
    </>
  );
}
