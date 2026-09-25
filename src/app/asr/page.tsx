"use client";

/**
 * Speech recognition, measured.
 *
 * The rest of this project treats the transcript as given. This page is the one
 * that admits the transcript is a model output too, and puts a number on it.
 *
 * Everything rendered here comes from public/data/asr-results.json, written by
 * `npm run asr`. Nothing is computed in the browser, so what a visitor reads is
 * exactly what the benchmark measured, and a claim cannot drift away from the
 * run that produced it.
 */

import { useEffect, useState } from "react";

interface Stage { key: string; label: string; note: string }
interface StageScore { stage: string; wer: number; sub: number; del: number; ins: number }

interface System {
  id: string;
  label: string;
  model: string;
  note: string;
  prompt?: string;
  n?: number;
  byStage?: StageScore[];
  wer?: number;
  werRaw?: number;
  cer?: number;
  devanagariShare?: number;
  meanLatencyMs?: number;
  unavailable?: string | null;
}

interface Example {
  clip: string;
  callId: string;
  reference: string;
  heard: Record<string, string>;
  ladders: Record<string, { stage: string; wer: number }[]>;
}

interface Results {
  ranAt: string;
  lines: number;
  voices: string[];
  stages: Stage[];
  systems: System[];
  examples: Example[];
  limitations: string[];
}

const SERIES = ["var(--series-1)", "var(--series-3)", "var(--series-5)"];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The ladder chart.
 *
 * One line per system, one point per normalisation stage, left to right from no
 * normalisation to full. The shape is the argument: a line that falls steeply
 * was never really failing at recognition, it was failing at spelling
 * conventions. A line that stays flat is the honest error.
 */
function Ladder({ stages, systems }: { stages: Stage[]; systems: System[] }) {
  const live = systems.filter((s) => s.byStage?.length);
  if (!live.length) return null;

  const W = 820, H = 300, L = 52, R = 18, T = 18, B = 74;
  // Round the top of the axis to a fifth, so the gridlines read 25/50/75 rather
  // than 24.7/49.5/74.2. An axis that needs decoding is an axis nobody reads.
  const peak = Math.max(0.05, ...live.flatMap((s) => s.byStage!.map((b) => b.wer)));
  const max = Math.ceil(peak / 0.2) * 0.2;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, stages.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);

  return (
    <div className="scroll-x">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 680, height: "auto" }}
           role="img" aria-label="Word error rate at each normalisation stage">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = max * f;
          return (
            <g key={f}>
              <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {stages.map((s, i) => (
          <text key={s.key} x={x(i)} y={H - B + 20} textAnchor="middle"
                style={{ fontSize: 11, fill: "var(--text-secondary)" }}>
            {s.label}
          </text>
        ))}

        {live.map((sys, si) => {
          const pts = sys.byStage!.map((b, i) => `${x(i)},${y(b.wer)}`).join(" ");
          return (
            <g key={sys.id}>
              <polyline points={pts} fill="none" stroke={SERIES[si % SERIES.length]} strokeWidth={2.4}
                        strokeLinejoin="round" strokeLinecap="round" />
              {sys.byStage!.map((b, i) => (
                <circle key={b.stage} cx={x(i)} cy={y(b.wer)} r={3.6} fill="var(--surface-1)"
                        stroke={SERIES[si % SERIES.length]} strokeWidth={2} />
              ))}
            </g>
          );
        })}

        {live.map((sys, si) => (
          <g key={`k-${sys.id}`} transform={`translate(${L + si * 250}, ${H - 26})`}>
            <rect width={14} height={3.5} y={4} rx={1.75} fill={SERIES[si % SERIES.length]} />
            <text x={20} y={9} style={{ fontSize: 11.5, fill: "var(--text-secondary)" }}>{sys.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** One clip, with what each system heard against the line that was spoken. */
function Worked({ ex, systems }: { ex: Example; systems: System[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Spoken line</div>
          <div className="card-sub mono">{ex.callId}</div>
        </div>
      </div>
      <p className="prose" style={{ fontWeight: 560 }}>{ex.reference}</p>
      <audio controls src={ex.clip} style={{ width: "100%", margin: "10px 0 14px" }} />
      <div style={{ display: "grid", gap: 10 }}>
        {systems.filter((s) => ex.heard[s.id]).map((s) => {
          const l = ex.ladders[s.id];
          const raw = l?.[0]?.wer ?? 0;
          const norm = l?.[l.length - 1]?.wer ?? 0;
          return (
            <div key={s.id} style={{
              borderLeft: "3px solid var(--border-strong)", paddingLeft: 12,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 620 }}>{s.label}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  raw {pct(raw)} → normalised {pct(norm)}
                </span>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 4, color: "var(--text-secondary)" }}>{ex.heard[s.id]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AsrPage() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/asr-results.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <section style={{ padding: "30px 0" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Speech recognition, measured</h1>
        <p className="prose">
          No benchmark has been run yet. <span className="mono">npm run asr</span> writes the results this page reads.
        </p>
      </section>
    );
  }
  if (!data) return <section style={{ padding: "30px 0" }}><p className="prose">Loading the benchmark…</p></section>;

  const live = data.systems.filter((s) => s.byStage?.length);
  const best = live.slice().sort((a, b) => (a.wer ?? 1) - (b.wer ?? 1))[0];
  const worst = live.slice().sort((a, b) => (b.wer ?? 0) - (a.wer ?? 0))[0];
  const thin = (live[0]?.n ?? 0) < 10;

  return (
    <>
      <section style={{ padding: "30px 0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Speech recognition, measured</h1>
      <p className="prose">
        Every other page here treats the transcript as a given. It is not: it is a model output, and on code-mixed
        Hindi and English it is the weakest link in the chain. This page speaks lines whose exact words are already
        known, sends the identical audio to three recognition setups, and scores what comes back.
      </p>
      <p className="prose">
        The three setups use <strong>the same model on the same audio</strong>. Only the instruction changes, so
        every difference in the table below is attributable to the prompt and to nothing else.
      </p>

      {thin && (
        <p className="prose" style={{ color: "var(--warning)" }}>
          This run covers {live[0]?.n} lines, which is too few to rank anything confidently. The free tier caps how
          much audio can be generated per day. Treat the ordering as indicative and the method as the point.
        </p>
      )}
      </section>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Results</div>
            <div className="card-sub">
              {live[0]?.n ?? 0} lines · scored twice, before and after normalisation
            </div>
          </div>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Setup</th>
                <th className="num">Raw WER</th>
                <th className="num">Normalised</th>
                <th className="num">CER</th>
                <th className="num">Devanagari</th>
                <th className="num">Latency</th>
              </tr>
            </thead>
            <tbody>
              {data.systems.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 580 }}>{s.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{s.note}</div>
                  </td>
                  {s.unavailable ? (
                    <td colSpan={5} style={{ color: "var(--text-muted)" }}>{s.unavailable}</td>
                  ) : (
                    <>
                      <td className="num mono">{pct(s.werRaw!)}</td>
                      <td className="num mono" style={{ fontWeight: 620 }}>{pct(s.wer!)}</td>
                      <td className="num mono">{pct(s.cer!)}</td>
                      <td className="num mono">{pct(s.devanagariShare!)}</td>
                      <td className="num mono">{Math.round(s.meanLatencyMs!)}ms</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {best && worst && best.id !== worst.id && (
          <p className="prose" style={{ marginTop: 12 }}>
            Same model, same audio. <strong>{best.label}</strong> lands at {pct(best.wer!)} and{" "}
            <strong>{worst.label}</strong> at {pct(worst.wer!)}. The gap is one sentence of instruction.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Where the errors actually are</div>
            <div className="card-sub">
              The same transcripts, scored at eight levels of normalisation
            </div>
          </div>
        </div>
        <p className="prose">
          A word error rate on Indic speech is partly a statement about the recogniser and partly a statement about
          how you chose to score it. Scored naively, a correct transcript written in Devanagari against a Roman
          reference is 100% wrong. So each pair is scored eight times, adding one normalisation at a time. How steeply
          a line falls tells you how much of its error was never recognition at all.
        </p>
        <Ladder stages={data.stages} systems={data.systems} />
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>Stage</th><th>What it does</th></tr></thead>
            <tbody>
              {data.stages.map((s) => (
                <tr key={s.key}><td style={{ fontWeight: 580 }}>{s.label}</td><td>{s.note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Listen to it</h2>
      <p className="prose">
        The audio below is exactly what each system was sent. Play it, then read what each one returned.
      </p>
      <div className="grid">
        {data.examples.map((ex) => <Worked key={ex.clip} ex={ex} systems={data.systems} />)}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">What this does not prove</div>
            <div className="card-sub">Read this before quoting any number above</div>
          </div>
        </div>
        <ul className="prose">
          {data.limitations.map((l) => <li key={l} style={{ marginBottom: 8 }}>{l}</li>)}
        </ul>
        <p className="prose" style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
          Run {new Date(data.ranAt).toLocaleString()} · voices: {data.voices.join(", ") || "n/a"} · reproduce with{" "}
          <span className="mono">npm run asr</span>
        </p>
      </div>
    </>
  );
}
