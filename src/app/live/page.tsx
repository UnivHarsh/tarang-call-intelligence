"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { CallInsight, Turn } from "@/lib/types";
import { INTENT_LABELS, RESOLUTION_LABELS, ROOT_CAUSE_LABELS } from "@/lib/types";
import { SentimentBar } from "@/components/charts";
import { LiveVoiceSession, type VoiceStatus } from "@/lib/live-voice";
import { VAPI_ASSISTANT_ID, VAPI_CONFIGURED, VAPI_PUBLIC_KEY, ASSISTANT_CONFIG } from "@/lib/vapi-assistant";

type Stage = "idle" | "connecting" | "live" | "extracting" | "done" | "error";

const PIPELINE = [
  { key: "capture", label: "Capture", detail: "Your mic, streamed as 16 kHz PCM" },
  { key: "converse", label: "Converse", detail: "Gemini Live answers in voice" },
  { key: "extract", label: "Extract", detail: "One pass, one structured record" },
  { key: "aggregate", label: "Aggregate", detail: "Folded into the dashboard" },
];

export default function LivePage() {
  const { addLiveCall, live, clearLive, calls, getTranscript } = useStore();

  const [stage, setStage] = useState<Stage>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<{ speaker: "agent" | "customer"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ insight: CallInsight; meta: Record<string, unknown> } | null>(null);
  const [level, setLevel] = useState(0);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const voiceRef = useRef<LiveVoiceSession | null>(null);
  const vapiRef = useRef<{ stop: () => void } | null>(null);
  const startedAt = useRef(0);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Whether the microphone path is available is a server fact (is a key set?),
  // so ask rather than guess.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setVoiceReady(Boolean(h.hasGeminiKey)))
      .catch(() => setVoiceReady(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, partial]);

  useEffect(
    () => () => {
      if (replayTimer.current) clearTimeout(replayTimer.current);
      void voiceRef.current?.stop();
      vapiRef.current?.stop();
    },
    [],
  );

  // ------------------------------------------------------------------
  // Every input path converges here: transcript in, structured record out.
  // ------------------------------------------------------------------
  const runExtraction = useCallback(
    async (finalTurns: Turn[], source: "voice" | "phone" | "replay" | "paste") => {
      if (finalTurns.length === 0) {
        setStage("idle");
        setError("Nothing was said, so there is no call to analyse.");
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

        const name =
          source === "voice" ? "You (live call)"
          : source === "phone" ? "You (phone call)"
          : source === "replay" ? "Replayed call"
          : "Pasted transcript";

        const call: CallInsight = {
          id: `live_${Date.now().toString(36)}`,
          startedAt: new Date(startedAt.current || Date.now()).toISOString(),
          durationSec,
          direction: "inbound",
          handledBy: data.insight.contained ? "voice_agent" : "human_agent",
          language: "hinglish",
          customer: { id: "live", name, city: "Bengaluru", segment: "growing", lifetimeOrders: 7 },
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
  // 1. Real voice, in the browser, over the Gemini Live API.
  // ------------------------------------------------------------------
  const startVoice = useCallback(async () => {
    setError(null);
    setResult(null);
    setTurns([]);
    setPartial(null);
    setStage("connecting");
    startedAt.current = Date.now();

    const session = new LiveVoiceSession({
      onStatus: (s: VoiceStatus) => {
        if (s === "live") setStage("live");
        if (s === "error") setStage("error");
      },
      onTurns: setTurns,
      onPartial: (speaker, text) => setPartial(text ? { speaker, text } : null),
      onLevel: setLevel,
      onError: (m) => setError(m),
    });
    voiceRef.current = session;

    try {
      await session.start();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not start the call.";
      setError(
        /permission|denied|NotAllowed/i.test(m)
          ? "Microphone permission was denied. Allow it in your browser and try again, or use Replay a sample call."
          : m,
      );
      setStage("error");
      voiceRef.current = null;
      await session.stop().catch(() => {});
    }
  }, []);

  const endVoice = useCallback(async () => {
    const session = voiceRef.current;
    if (!session) return;
    voiceRef.current = null;
    const finalTurns = await session.stop();
    setPartial(null);
    setLevel(0);
    void runExtraction(finalTurns, "voice");
  }, [runExtraction]);

  // ------------------------------------------------------------------
  // 2. Optional: the same agent over a real phone line, via Vapi.
  // ------------------------------------------------------------------
  const startPhone = useCallback(async () => {
    setError(null);
    setResult(null);
    setTurns([]);
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
      vapi.on("volume-level", (v: number) => setLevel(v));
      vapi.on("message", (msg: { type?: string; role?: string; transcriptType?: string; transcript?: string }) => {
        if (msg?.type !== "transcript" || !msg.transcript || msg.transcriptType === "partial") return;
        collected.push({
          role: msg.role === "assistant" ? "agent" : "customer",
          text: msg.transcript,
          tMs: Date.now() - startedAt.current,
          conf: 0.92,
        });
        setTurns([...collected]);
      });
      vapi.on("error", (e: unknown) => {
        setError(`Voice connection error: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
        setStage("error");
      });
      vapi.on("call-end", () => {
        vapiRef.current = null;
        void runExtraction(collected, "phone");
      });

      await vapi.start(
        VAPI_ASSISTANT_ID ? VAPI_ASSISTANT_ID : (ASSISTANT_CONFIG as unknown as Parameters<typeof vapi.start>[0]),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the phone call.");
      setStage("error");
    }
  }, [runExtraction]);

  // ------------------------------------------------------------------
  // 3. Replay — a real corpus transcript through the same pipeline.
  // ------------------------------------------------------------------
  const startReplay = useCallback(() => {
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
    setPartial(null);
    setStage("live");
    startedAt.current = Date.now();

    let i = 0;
    const step = () => {
      if (i >= source.length) {
        void runExtraction(source, "replay");
        return;
      }
      setTurns(source.slice(0, i + 1));
      i++;
      const gap = i < source.length ? Math.max(220, (source[i].tMs - source[i - 1].tMs) / 6) : 500;
      replayTimer.current = setTimeout(step, Math.min(1400, gap));
    };
    step();
  }, [calls, getTranscript, runExtraction]);

  // ------------------------------------------------------------------
  // 4. Paste — test the extractor on your own text.
  // ------------------------------------------------------------------
  const runPaste = useCallback(() => {
    const lines = pasteText.split("\n").map((l) => l.trim()).filter(Boolean);
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
    stage === "idle" || stage === "error" ? -1
    : stage === "connecting" ? 0
    : stage === "live" ? 1
    : stage === "extracting" ? 2
    : 3;

  const busy = stage === "connecting" || stage === "live" || stage === "extracting";
  const inVoiceCall = stage === "live" && voiceRef.current !== null;

  return (
    <>
      <section style={{ padding: "30px 0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Live demo</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "72ch" }}>
          Press the button and actually talk to the support agent. She answers out loud, in Hinglish, and interrupts
          properly if you talk over her. Hang up and the conversation goes through the same extraction the 933 seeded
          calls went through, landing in the dashboard alongside them.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 10, maxWidth: "72ch" }}>
          Try: a three-day-late order, a melted packet of butter, or a coupon that will not apply. Argue with her a bit —
          the extraction picks up escalation and churn risk, and you will only see that if you push.
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
                    width: 22, height: 22, flex: "none", borderRadius: 999,
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
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
              {stage === "live" ? "on the call" : stage === "connecting" ? "connecting" : stage === "extracting" ? "analysing" : "ready"}
            </span>
          </div>

          {voiceReady === false && (
            <div
              style={{
                background: "color-mix(in srgb, var(--warning) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)",
                borderRadius: 8, padding: "10px 12px", fontSize: 12.5,
                margin: "10px 0 14px", color: "var(--text-secondary)",
              }}
            >
              This deployment has no Gemini key, so the microphone is off. Everything else is live — use{" "}
              <strong>Replay a sample call</strong> or <strong>Paste a transcript</strong>.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "14px 0 6px" }}>
            {inVoiceCall ? (
              <button className="btn btn-danger" onClick={() => void endVoice()}>
                Hang up &amp; analyse
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void startVoice()} disabled={busy || voiceReady !== true}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Talk to the agent
              </button>
            )}

            {VAPI_CONFIGURED && !inVoiceCall && (
              <button className="btn" onClick={() => void startPhone()} disabled={busy}>
                Call over telephony
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

          {inVoiceCall && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>mic</span>
              <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, level * 180)}%`, height: "100%",
                    background: "var(--series-1)", borderRadius: 3, transition: "width 90ms linear",
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>speak normally</span>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 14, padding: "10px 12px", borderRadius: 8,
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
            style={{ marginTop: 16, maxHeight: 420, minHeight: 180, overflowY: "auto", borderTop: "1px solid var(--grid)", paddingTop: 12 }}
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
                        {t.role === "agent" ? "MAYA" : "YOU"}
                      </div>
                      {t.text}
                    </div>
                  </div>
                ))}
                {partial && (
                  <div className="turn" data-role={partial.speaker} style={{ opacity: 0.6 }}>
                    <div className="turn-meta">···</div>
                    <div className="turn-body">
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 2, fontWeight: 620 }}>
                        {partial.speaker === "agent" ? "MAYA" : "YOU"}
                      </div>
                      {partial.text}
                    </div>
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
              Nothing yet. Talk to the agent, replay a sample, or paste a transcript — whichever you pick, the same
              extraction pass runs and the same schema comes back.
            </p>
          )}

          {result && stage === "done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
              <div style={{ fontSize: 14, lineHeight: 1.55 }}>{result.insight.summary}</div>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Intent</div>
                  <div style={{ fontSize: 13 }}>{INTENT_LABELS[result.insight.primaryIntent] ?? result.insight.primaryIntent}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Root cause</div>
                  <div style={{ fontSize: 13 }}>{ROOT_CAUSE_LABELS[result.insight.rootCause] ?? result.insight.rootCause}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Resolution</div>
                  <div style={{ fontSize: 13 }}>{RESOLUTION_LABELS[result.insight.resolution] ?? result.insight.resolution}</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Predicted CSAT</div>
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
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Pulled quotes</div>
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
                    borderRadius: 8, padding: 12,
                  }}
                >
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 5 }}>Product signal raised</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{result.insight.productSignal.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {result.insight.productSignal.evidence}
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Next best action</div>
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

      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 18, maxWidth: "76ch" }}>
        Your microphone streams straight from this page to Google&rsquo;s Gemini Live API over a WebSocket, using a
        single-use token minted server-side — the API key never reaches your browser. This runs on Google&rsquo;s free
        tier, where submitted content may be used to improve their models, which is fine for a demo about a fictional
        company and the reason a real deployment would sit on the paid tier.
      </p>

      {live.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "var(--text-muted)" }}>
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
