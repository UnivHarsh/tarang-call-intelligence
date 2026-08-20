"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { CallInsight, Turn } from "@/lib/types";
import { INTENT_LABELS, RESOLUTION_LABELS, ROOT_CAUSE_LABELS } from "@/lib/types";
import { SentimentBar } from "@/components/charts";
import { CallStage, type CallPhase } from "@/components/call-stage";
import { LiveVoiceSession, type VoiceStatus } from "@/lib/live-voice";
import { VAPI_ASSISTANT_ID, VAPI_CONFIGURED, VAPI_PUBLIC_KEY, ASSISTANT_CONFIG } from "@/lib/vapi-assistant";

type Source = "voice" | "phone" | "replay" | "paste";

export default function LivePage() {
  const { addLiveCall, live, clearLive, calls, getTranscript } = useStore();

  const [phase, setPhase] = useState<CallPhase>("idle");
  const [analysing, setAnalysing] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [caption, setCaption] = useState<{ speaker: "agent" | "customer"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ insight: CallInsight; meta: Record<string, unknown> } | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [agentLevel, setAgentLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const voiceRef = useRef<LiveVoiceSession | null>(null);
  const vapiRef = useRef<{ stop: () => void } | null>(null);
  const startedAt = useRef(0);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setVoiceReady(Boolean(h.hasGeminiKey)))
      .catch(() => setVoiceReady(false));
  }, []);

  // Call timer, driven off the real start time so it survives a slow render.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase]);

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
    async (finalTurns: Turn[], source: Source) => {
      if (finalTurns.length === 0) {
        setPhase("idle");
        setError("Nothing was said, so there is no call to analyse.");
        return;
      }
      setPhase("ended");
      setAnalysing(true);
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Extraction failed.");
      } finally {
        setAnalysing(false);
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
    setCaption(null);
    setSeconds(0);
    setMuted(false);
    setPhase("connecting");
    startedAt.current = Date.now();

    const session = new LiveVoiceSession({
      onStatus: (s: VoiceStatus) => {
        if (s === "live") {
          startedAt.current = Date.now();
          setPhase("live");
        }
        if (s === "error") setPhase("idle");
      },
      onTurns: setTurns,
      onPartial: (speaker, text) => setCaption(text ? { speaker, text } : null),
      onLevel: setMicLevel,
      onAgentLevel: setAgentLevel,
      onError: setError,
    });
    voiceRef.current = session;

    try {
      await session.start();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not start the call.";
      setError(
        /permission|denied|NotAllowed/i.test(m)
          ? "Microphone permission was denied. Allow it in your browser and try again, or replay a sample call below."
          : m,
      );
      setPhase("idle");
      voiceRef.current = null;
      await session.stop().catch(() => {});
    }
  }, []);

  const endVoice = useCallback(async () => {
    const session = voiceRef.current;
    if (!session) return;
    voiceRef.current = null;
    const finalTurns = await session.stop();
    setCaption(null);
    setMicLevel(0);
    setAgentLevel(0);
    void runExtraction(finalTurns, "voice");
  }, [runExtraction]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      voiceRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  // ------------------------------------------------------------------
  // 2. Optional: the same agent over a real phone line, via Vapi.
  // ------------------------------------------------------------------
  const startPhone = useCallback(async () => {
    setError(null);
    setResult(null);
    setTurns([]);
    setSeconds(0);
    setPhase("connecting");
    startedAt.current = Date.now();

    try {
      const { default: Vapi } = await import("@vapi-ai/web");
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapiRef.current = vapi;
      const collected: Turn[] = [];

      vapi.on("call-start", () => {
        startedAt.current = Date.now();
        setPhase("live");
      });
      vapi.on("volume-level", (v: number) => setAgentLevel(v));
      vapi.on("message", (msg: { type?: string; role?: string; transcriptType?: string; transcript?: string }) => {
        if (msg?.type !== "transcript" || !msg.transcript) return;
        const role: Turn["role"] = msg.role === "assistant" ? "agent" : "customer";
        if (msg.transcriptType === "partial") {
          setCaption({ speaker: role, text: msg.transcript });
          return;
        }
        collected.push({ role, text: msg.transcript, tMs: Date.now() - startedAt.current, conf: 0.92 });
        setTurns([...collected]);
      });
      vapi.on("error", (e: unknown) => {
        setError(`Voice connection error: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
        setPhase("idle");
      });
      vapi.on("call-end", () => {
        vapiRef.current = null;
        setCaption(null);
        void runExtraction(collected, "phone");
      });

      await vapi.start(
        VAPI_ASSISTANT_ID ? VAPI_ASSISTANT_ID : (ASSISTANT_CONFIG as unknown as Parameters<typeof vapi.start>[0]),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the phone call.");
      setPhase("idle");
    }
  }, [runExtraction]);

  const endPhone = useCallback(() => vapiRef.current?.stop(), []);

  // ------------------------------------------------------------------
  // 3 & 4. Replay a seeded call, or paste your own transcript.
  // ------------------------------------------------------------------
  const startReplay = useCallback(() => {
    const candidates = calls.filter((c) => c.extractedBy === "seed" && c.productSignal);
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const source = getTranscript(pick);

    if (!source?.length) {
      setError("Transcripts are still loading in the background — give it a second and try again.");
      return;
    }

    setError(null);
    setResult(null);
    setTurns([]);
    setSeconds(0);
    setPhase("live");
    startedAt.current = Date.now();

    let i = 0;
    const step = () => {
      if (i >= source.length) {
        setCaption(null);
        void runExtraction(source, "replay");
        return;
      }
      setTurns(source.slice(0, i + 1));
      setCaption({ speaker: source[i].role, text: source[i].text });
      i++;
      const gap = i < source.length ? Math.max(220, (source[i].tMs - source[i - 1].tMs) / 6) : 500;
      replayTimer.current = setTimeout(step, Math.min(1400, gap));
    };
    step();
  }, [calls, getTranscript, runExtraction]);

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

  const inCall = phase === "live" || phase === "connecting";
  const onPhoneCall = inCall && vapiRef.current !== null;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Talk to the agent</h1>
        <p className="page-sub">
          A real conversation, out loud, in Hinglish. Interrupt her and she stops mid-sentence. When you hang up the call
          goes through the same extraction as the {calls.length.toLocaleString("en-IN")} calls in the dashboard, and lands
          alongside them.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 18, alignItems: "start" }}>
        <div>
          <CallStage
            phase={phase}
            micLevel={micLevel}
            agentLevel={agentLevel}
            seconds={seconds}
            muted={muted}
            canCall={voiceReady === true}
            caption={caption}
            onStart={startVoice}
            onEnd={onPhoneCall ? endPhone : () => void endVoice()}
            onToggleMute={toggleMute}
          />

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "11px 14px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--critical) 9%, transparent)",
                border: "1px solid color-mix(in srgb, var(--critical) 30%, transparent)",
                fontSize: 12.5,
                lineHeight: 1.55,
              }}
            >
              {error}
            </div>
          )}

          {!inCall && (
            <>
              <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
                <button className="quiet-link" onClick={startReplay} disabled={analysing}>
                  Replay a sample call
                </button>
                <button className="quiet-link" onClick={() => setPasteOpen((v) => !v)} disabled={analysing}>
                  Paste a transcript
                </button>
                {VAPI_CONFIGURED && (
                  <button className="quiet-link" onClick={() => void startPhone()} disabled={analysing}>
                    Call over telephony
                  </button>
                )}
              </div>

              {pasteOpen && (
                <div className="card" style={{ marginTop: 14 }}>
                  <textarea
                    className="input"
                    rows={6}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
                    placeholder={"Customer: mera order teen din late hai aur koi update nahi hai\nAgent: main abhi check karti hoon..."}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
                    <button className="btn btn-primary" onClick={runPaste} disabled={!pasteText.trim()}>
                      Extract
                    </button>
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      One line per turn. Prefix Customer: or Agent:
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 22, lineHeight: 1.6 }}>
            Your microphone streams from this page to Google&rsquo;s Gemini Live API over a WebSocket, using a single-use
            token minted server-side — the API key never reaches your browser. On the free tier, submitted content may be
            used to improve their models.
          </p>
        </div>

        {/* Result ------------------------------------------------------ */}
        <div>
          {analysing && (
            <div className="card">
              <div className="card-title">Reading the call…</div>
              <div style={{ marginTop: 16 }}>
                <div className="skeleton" style={{ height: 14, width: "88%", marginBottom: 9 }} />
                <div className="skeleton" style={{ height: 14, width: "72%", marginBottom: 9 }} />
                <div className="skeleton" style={{ height: 14, width: "54%" }} />
              </div>
            </div>
          )}

          {!analysing && !result && (
            <div className="card">
              <div className="card-title">What comes back</div>
              <p className="card-sub" style={{ marginBottom: 0, marginTop: 8 }}>
                Intent, root cause, sentiment arc, resolution, escalation and churn risk, verbatim quotes, and any product
                signal worth acting on. The same fixed schema every call in the dashboard has.
              </p>
            </div>
          )}

          {!analysing && result && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">Extracted record</div>
                <span className="chip">
                  {result.meta.extractedBy === "llm" ? String(result.meta.model ?? "model") : "rules engine"}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
                <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{result.insight.summary}</div>

                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 14 }}>
                  {[
                    ["Intent", INTENT_LABELS[result.insight.primaryIntent] ?? result.insight.primaryIntent],
                    ["Root cause", ROOT_CAUSE_LABELS[result.insight.rootCause] ?? result.insight.rootCause],
                    ["Resolution", RESOLUTION_LABELS[result.insight.resolution] ?? result.insight.resolution],
                    ["Predicted CSAT", `${result.insight.csatPredicted} / 5`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>

                <SentimentBar start={result.insight.sentimentStart} end={result.insight.sentimentEnd} />

                <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 14, fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {result.insight.rootCauseNote}
                </div>

                {result.insight.quotes?.length > 0 && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Pulled quotes</div>
                    {result.insight.quotes.map((q, i) => (
                      <div key={i} style={{ fontSize: 12.5, marginBottom: 10, paddingLeft: 11, boxShadow: "inset 2px 0 0 var(--warning)" }}>
                        <div>“{q.text}”</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>{q.tag}</div>
                      </div>
                    ))}
                  </div>
                )}

                {result.insight.productSignal && (
                  <div
                    style={{
                      background: "color-mix(in srgb, var(--critical) 7%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--critical) 26%, transparent)",
                      borderRadius: 10,
                      padding: 13,
                    }}
                  >
                    <div className="eyebrow" style={{ fontSize: 10, marginBottom: 5 }}>Product signal raised</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{result.insight.productSignal.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                      {result.insight.productSignal.evidence}
                    </div>
                  </div>
                )}

                <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 14 }}>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 5 }}>Next best action</div>
                  <div style={{ fontSize: 13 }}>{result.insight.nextBestAction}</div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {typeof result.meta.extractionMs === "number" && Number(result.meta.extractionMs) > 0 && (
                    <span className="chip">{Math.round(Number(result.meta.extractionMs))} ms</span>
                  )}
                  {typeof result.meta.extractionCostUsd === "number" && Number(result.meta.extractionCostUsd) > 0 && (
                    <span className="chip">${Number(result.meta.extractionCostUsd).toFixed(4)}</span>
                  )}
                  <Link className="btn" href="/calls" style={{ padding: "5px 12px", fontSize: 12, marginLeft: "auto" }}>
                    See it in the dashboard →
                  </Link>
                </div>

                {typeof result.meta.note === "string" && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                    {result.meta.note}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transcript, once there is one worth reading. */}
          {turns.length > 0 && !inCall && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">Transcript</div>
              <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 10 }}>
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
              </div>
            </div>
          )}
        </div>
      </div>

      {live.length > 0 && !inCall && (
        <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "var(--text-muted)" }}>
          <span>
            {live.length === 1
              ? "1 call of yours is in the dashboard, stored in this browser only."
              : `${live.length} calls of yours are in the dashboard, stored in this browser only.`}
          </span>
          <button className="quiet-link" onClick={clearLive}>
            Clear them
          </button>
        </div>
      )}
    </>
  );
}
