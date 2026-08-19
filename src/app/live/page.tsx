"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { CallInsight, Turn } from "@/lib/types";
import { INTENT_LABELS, RESOLUTION_LABELS, ROOT_CAUSE_LABELS } from "@/lib/types";
import { SentimentBar } from "@/components/charts";
import { VAPI_ASSISTANT_ID, VAPI_CONFIGURED, VAPI_PUBLIC_KEY, ASSISTANT_CONFIG } from "@/lib/vapi-assistant";

type Stage = "idle" | "connecting" | "live" | "extracting" | "done" | "error";

const PIPELINE = [
  { key: "capture", label: "Capture", detail: "WebRTC audio to the voice agent" },
  { key: "transcribe", label: "Transcribe", detail: "Streaming multilingual speech-to-text" },
  { key: "extract", label: "Extract", detail: "One pass, one structured record" },
  { key: "aggregate", label: "Aggregate", detail: "Folded into the dashboard" },
];

export default function LivePage() {
  const { addLiveCall, live, clearLive, calls, getTranscript } = useStore();

  const [stage, setStage] = useState<Stage>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ insight: CallInsight; meta: Record<string, unknown> } | null>(null);
  const [volume, setVolume] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const vapiRef = useRef<{ stop: () => void } | null>(null);
  const startedAt = useRef<number>(0);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, partial]);

  useEffect(
    () => () => {
      if (replayTimer.current) clearTimeout(replayTimer.current);
      vapiRef.current?.stop();
    },
    [],
  );

  // ------------------------------------------------------------------
  // The one place every input path converges: transcript in, record out.
  // ------------------------------------------------------------------
  const runExtraction = useCallback(
    async (finalTurns: Turn[], source: "live" | "replay" | "paste") => {
      if (finalTurns.length === 0) {
        setStage("idle");
        return;
      }
      setStage("extracting");
      setError(null);

      const durationSec = Math.round((finalTurns[finalTurns.length - 1].tMs + 4000) / 1000);

      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: finalTurns, durationSec, city: "Bengaluru" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Extraction failed (${res.status})`);

        const id = `live_${Date.now().toString(36)}`;
        const call: CallInsight = {
          id,
          startedAt: new Date(startedAt.current || Date.now()).toISOString(),
          durationSec,
          direction: "inbound",
          handledBy: data.insight.contained ? "voice_agent" : "human_agent",
          language: "hinglish",
          customer: {
            id: "live",
            name: source === "live" ? "You (live call)" : source === "replay" ? "Replayed call" : "Pasted transcript",
            city: "Bengaluru",
            segment: "growing",
            lifetimeOrders: 7,
          },
          order: null,
          transcript: finalTurns,
          asrWer: 0.08,
          ...data.insight,
          extractedBy: data.extractedBy,
          extractionMs: data.extractionMs,
          extractionCostUsd: data.extractionCostUsd,
        };

        addLiveCall(call, finalTurns);
        setResult({ insight: call, meta: data });
        setStage("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Extraction failed.");
        setStage("error");
      }
    },
    [addLiveCall],
  );

  // ------------------------------------------------------------------
  // 1. Real voice call
  // ------------------------------------------------------------------
  const startCall = useCallback(async () => {
    setError(null);
    setResult(null);
    setTurns([]);
    setPartial("");
    setStage("connecting");
    startedAt.current = Date.now();

    try {
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapiRef.current = vapi;

      const collected: Turn[] = [];

      vapi.on("call-start", () => {
        startedAt.current = Date.now();
        setStage("live");
      });

      vapi.on("volume-level", (v: number) => setVolume(v));

      vapi.on("message", (msg: { type?: string; role?: string; transcriptType?: string; transcript?: string }) => {
        if (msg?.type !== "transcript" || !msg.transcript) return;
        const role: Turn["role"] = msg.role === "assistant" ? "agent" : "customer";

        if (msg.transcriptType === "partial") {
          setPartial(`${role === "agent" ? "Maya" : "You"}: ${msg.transcript}`);
          return;
        }
        // Only final transcripts land in the record. Partials exist to make the
        // UI feel live; extracting from them would double-count corrections.
        const turn: Turn = {
          role,
          text: msg.transcript,
          tMs: Date.now() - startedAt.current,
          conf: 0.92,
        };
        collected.push(turn);
        setPartial("");
        setTurns([...collected]);
      });

      vapi.on("error", (e: unknown) => {
        const m = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        setError(`Voice connection error: ${m}`);
        setStage("error");
      });

      vapi.on("call-end", () => {
        setPartial("");
        void runExtraction(collected, "live");
      });

      await vapi.start(
        VAPI_ASSISTANT_ID
          ? VAPI_ASSISTANT_ID
          : (ASSISTANT_CONFIG as unknown as Parameters<typeof vapi.start>[0]),
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not start the call.";
      setError(
        m.toLowerCase().includes("permission") || m.toLowerCase().includes("denied")
          ? "Microphone permission was denied. Allow it in your browser, or use Replay a sample call below."
          : m,
      );
      setStage("error");
    }
  }, [runExtraction]);

  const endCall = useCallback(() => {
    vapiRef.current?.stop();
  }, []);

  // ------------------------------------------------------------------
  // 2. Replay — streams a real corpus transcript through the same pipeline.
  //    No microphone, no keys, same extraction call at the end.
  // ------------------------------------------------------------------
  const startReplay = useCallback(() => {
    // Transcripts live in the lazily-fetched payload, not on the index record.
    const candidates = calls.filter((c) => c.extractedBy === "seed" && c.productSignal);
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const source = getTranscript(pick);

    if (!source?.length) {
      setError("Transcripts are still loading in the background — give it a second and try again.");
      setStage("error");
      return;
    }

    setError(null);
    setResult(null);
    setTurns([]);
    setPartial("");
    setStage("live");
    startedAt.current = Date.now();

    let i = 0;
    const step = () => {
      if (i >= source.length) {
        setPartial("");
        void runExtraction(source, "replay");
        return;
      }
      setTurns(source.slice(0, i + 1));
      i++;
      // Compressed 6x — a faithful 3-minute replay is not a demo.
      const gap = i < source.length ? Math.max(220, (source[i].tMs - source[i - 1].tMs) / 6) : 500;
      replayTimer.current = setTimeout(step, Math.min(1400, gap));
    };
    step();
  }, [calls, getTranscript, runExtraction]);

  // ------------------------------------------------------------------
  // 3. Paste — for reviewers who want to test the extractor on their own text.
  // ------------------------------------------------------------------
  const runPaste = useCallback(() => {
    const lines = pasteText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;

    const parsed: Turn[] = lines.map((line, i) => {
      const m = line.match(/^(agent|maya|customer|caller|you)\s*[:\-]\s*(.*)$/i);
      const role: Turn["role"] = m ? (/agent|maya/i.test(m[1]) ? "agent" : "customer") : i % 2 === 0 ? "customer" : "agent";
      return { role, text: m ? m[2] : line, tMs: i * 6000, conf: 0.95 };
    });

    setTurns(parsed);
    setResult(null);
    startedAt.current = Date.now();
    setPasteOpen(false);
    void runExtraction(parsed, "paste");
  }, [pasteText, runExtraction]);

  const stageIndex =
    stage === "idle" || stage === "error" ? -1 : stage === "connecting" ? 0 : stage === "live" ? 1 : stage === "extracting" ? 2 : 3;

  const busy = stage === "connecting" || stage === "live" || stage === "extracting";

  return (
    <>
      <section style={{ padding: "30px 0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Live demo</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "72ch" }}>
          Talk to the support agent the way a customer would — try a delayed order, a melted packet of butter, a coupon
          that will not apply. When you hang up, the transcript goes through the same extraction the 933 seeded calls
          went through, and the result lands in the dashboard alongside them.
        </p>
      </section>

      {/* Pipeline ------------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
          {PIPELINE.map((p, i) => {
            const state = stageIndex > i ? "done" : stageIndex === i ? "active" : "todo";
            return (
              <div key={p.key} style={{ flex: "1 1 170px", display: "flex", alignItems: "flex-start", gap: 10, padding: "2px 10px 2px 0" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    flex: "none",
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    background: state === "done" ? "var(--good)" : state === "active" ? "var(--series-1)" : "var(--surface-2)",
                    color: state === "todo" ? "var(--text-muted)" : "#fff",
                    border: state === "todo" ? "1px solid var(--border)" : "none",
                    animation: state === "active" ? "pulse 1.4s ease-in-out infinite" : undefined,
                  }}
                >
                  {state === "done" ? "✓" : i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: state === "todo" ? "var(--text-muted)" : "var(--text-primary)" }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 16, alignItems: "start" }}>
        {/* Call panel -------------------------------------------------- */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">The call</div>
            <span className="chip">
              {stage === "live" ? "connected" : stage === "connecting" ? "connecting" : stage === "extracting" ? "analysing" : "ready"}
            </span>
          </div>

          {!VAPI_CONFIGURED && (
            <div
              style={{
                background: "color-mix(in srgb, var(--warning) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12.5,
                margin: "10px 0 14px",
                color: "var(--text-secondary)",
              }}
            >
              No voice key is configured on this deployment, so the microphone path is off. Everything else here is live —
              use <strong>Replay a sample call</strong> or <strong>Paste a transcript</strong> and the extraction runs for
              real.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "14px 0 6px" }}>
            {stage === "live" && vapiRef.current ? (
              <button className="btn btn-danger" onClick={endCall}>
                End call
              </button>
            ) : (
              <button className="btn btn-primary" onClick={startCall} disabled={!VAPI_CONFIGURED || busy}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "currentColor",
                    display: "inline-block",
                  }}
                />
                Start a voice call
              </button>
            )}
            <button className="btn" onClick={startReplay} disabled={busy}>
              Replay a sample call
            </button>
            <button className="btn" onClick={() => setPasteOpen((v) => !v)} disabled={busy}>
              Paste a transcript
            </button>
          </div>

          {pasteOpen && (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="input"
                rows={7}
                style={{ fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
                placeholder={"Customer: mera order teen din late hai aur koi update nahi hai\nAgent: main abhi check karti hoon..."}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <button className="btn btn-primary" onClick={runPaste} disabled={!pasteText.trim()}>
                  Extract
                </button>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  One line per turn. Prefix with Customer: or Agent: — otherwise turns alternate.
                </span>
              </div>
            </div>
          )}

          {stage === "live" && vapiRef.current && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>mic</span>
              <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, volume * 220)}%`,
                    height: "100%",
                    background: "var(--series-1)",
                    borderRadius: 3,
                    transition: "width 90ms linear",
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--critical) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--critical) 35%, transparent)",
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}

          <div
            ref={scrollRef}
            style={{
              marginTop: 16,
              maxHeight: 420,
              minHeight: 180,
              overflowY: "auto",
              borderTop: "1px solid var(--grid)",
              paddingTop: 12,
            }}
          >
            {turns.length === 0 && !partial ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "38px 0", textAlign: "center" }}>
                The transcript appears here as it is spoken.
              </div>
            ) : (
              <>
                {turns.map((t, i) => (
                  <div className="turn" data-role={t.role} key={i}>
                    <div className="turn-meta">
                      {String(Math.floor(t.tMs / 60000)).padStart(2, "0")}:
                      {String(Math.floor((t.tMs % 60000) / 1000)).padStart(2, "0")}
                    </div>
                    <div className="turn-body">
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 2, fontWeight: 620 }}>
                        {t.role === "agent" ? "MAYA" : "CUSTOMER"}
                      </div>
                      {t.text}
                    </div>
                  </div>
                ))}
                {partial && (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic", padding: "6px 0 0 62px" }}>
                    {partial}…
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Result panel ------------------------------------------------ */}
        <div className="card" style={{ minHeight: 300 }}>
          <div className="card-head">
            <div className="card-title">Extracted record</div>
            {result && (
              <span className="chip">
                {result.meta.extractedBy === "llm" ? String(result.meta.model ?? "model") : "rules engine"}
              </span>
            )}
          </div>

          {stage === "extracting" && (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <div className="skeleton" style={{ height: 16, width: "70%", margin: "0 auto 10px" }} />
              <div className="skeleton" style={{ height: 16, width: "50%", margin: "0 auto 22px" }} />
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Reading the call…</div>
            </div>
          )}

          {!result && stage !== "extracting" && (
            <p className="card-sub" style={{ marginTop: 12 }}>
              Nothing yet. Start a call, replay a sample, or paste a transcript — whichever you pick, the same extraction
              pass runs and the same schema comes back.
            </p>
          )}

          {result && stage === "done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
              <div style={{ fontSize: 14, lineHeight: 1.55 }}>{result.insight.summary}</div>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>
                    Intent
                  </div>
                  <div style={{ fontSize: 13 }}>{INTENT_LABELS[result.insight.primaryIntent] ?? result.insight.primaryIntent}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>
                    Root cause
                  </div>
                  <div style={{ fontSize: 13 }}>{ROOT_CAUSE_LABELS[result.insight.rootCause] ?? result.insight.rootCause}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>
                    Resolution
                  </div>
                  <div style={{ fontSize: 13 }}>{RESOLUTION_LABELS[result.insight.resolution] ?? result.insight.resolution}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>
                    Predicted CSAT
                  </div>
                  <div className="num" style={{ fontSize: 17, fontWeight: 640 }}>
                    {result.insight.csatPredicted}
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}> / 5</span>
                  </div>
                </div>
              </div>

              <SentimentBar start={result.insight.sentimentStart} end={result.insight.sentimentEnd} />

              <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 12, fontSize: 12.5, color: "var(--text-secondary)" }}>
                {result.insight.rootCauseNote}
              </div>

              {result.insight.quotes?.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>
                    Pulled quotes
                  </div>
                  {result.insight.quotes.map((q, i) => (
                    <div key={i} style={{ fontSize: 12.5, marginBottom: 8, paddingLeft: 10, boxShadow: "inset 3px 0 0 var(--warning)" }}>
                      <div>“{q.text}”</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{q.tag}</div>
                    </div>
                  ))}
                </div>
              )}

              {result.insight.productSignal && (
                <div
                  style={{
                    background: "color-mix(in srgb, var(--critical) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--critical) 30%, transparent)",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 5 }}>
                    Product signal raised
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{result.insight.productSignal.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {result.insight.productSignal.evidence}
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>
                  Next best action
                </div>
                <div style={{ fontSize: 13 }}>{result.insight.nextBestAction}</div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {typeof result.meta.extractionMs === "number" && (
                  <span className="chip">{Math.round(Number(result.meta.extractionMs))} ms</span>
                )}
                {typeof result.meta.extractionCostUsd === "number" && Number(result.meta.extractionCostUsd) > 0 && (
                  <span className="chip">${Number(result.meta.extractionCostUsd).toFixed(4)}</span>
                )}
                <Link className="btn" href="/calls" style={{ padding: "5px 11px", fontSize: 12, marginLeft: "auto" }}>
                  See it in the dashboard →
                </Link>
              </div>

              {typeof result.meta.note === "string" && (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", borderTop: "1px solid var(--grid)", paddingTop: 10 }}>
                  {result.meta.note}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {live.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "var(--text-muted)" }}>
          <span>
            {live.length === 1
              ? "1 call of yours is in the dashboard, stored in this browser only."
              : `${live.length} calls of yours are in the dashboard, stored in this browser only.`}
          </span>
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={clearLive}>
            Clear them
          </button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
    </>
  );
}
