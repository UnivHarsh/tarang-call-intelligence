"use client";

import { useEffect, useState } from "react";
import type { CallInsight, Turn } from "@/lib/types";
import { INTENT_LABELS, RESOLUTION_LABELS, ROOT_CAUSE_LABELS, ROOT_CAUSE_OWNER } from "@/lib/types";
import { dateTime, duration, inr } from "@/lib/analytics";
import { SentimentBar } from "./charts";
import { useStore } from "@/lib/store";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function RiskBar({ value, label }: { value: number; label: string }) {
  const tone = value > 0.66 ? "var(--critical)" : value > 0.4 ? "var(--serious)" : "var(--good)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4 }}>
        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span className="num" style={{ fontWeight: 620 }}>
          {(value * 100).toFixed(0)}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value * 100}%`, height: "100%", background: tone, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function Transcript({ turns, quotes }: { turns: Turn[]; quotes: CallInsight["quotes"] }) {
  const quoteTexts = new Set(quotes.map((q) => q.text.trim()));
  return (
    <div>
      {turns.map((t, i) => {
        const isQuote = quoteTexts.has(t.text.trim());
        const lowConf = t.conf < 0.75;
        return (
          <div className="turn" data-role={t.role} key={i}>
            <div className="turn-meta">
              {String(Math.floor(t.tMs / 60000)).padStart(2, "0")}:
              {String(Math.floor((t.tMs % 60000) / 1000)).padStart(2, "0")}
            </div>
            <div className={`turn-body${isQuote ? " turn-quote" : ""}`}>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 2, fontWeight: 620, letterSpacing: "0.04em" }}>
                {t.role === "agent" ? "AGENT" : "CUSTOMER"}
                {lowConf && (
                  <span
                    className="low-conf"
                    style={{ marginLeft: 8, fontWeight: 500, letterSpacing: 0 }}
                    title={`Speech-to-text confidence ${(t.conf * 100).toFixed(0)}% — this line may be mistranscribed.`}
                  >
                    low confidence {(t.conf * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {t.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CallDetail({ call, onClose }: { call: CallInsight; onClose: () => void }) {
  const { getTranscript, transcriptsReady } = useStore();
  const [showJson, setShowJson] = useState(false);
  const turns = getTranscript(call);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const compliance = Object.entries(call.agentCompliance);
  const passed = compliance.filter(([, v]) => v).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Call ${call.id}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 80,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 100%)",
          background: "var(--plane)",
          height: "100%",
          overflowY: "auto",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--plane)",
            borderBottom: "1px solid var(--border)",
            padding: "14px 22px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 640, fontSize: 14 }}>
              {call.customer.name} · {call.customer.city}
            </div>
            <div className="mono" style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
              {call.id} · {dateTime(call.startedAt)} · {duration(call.durationSec)} · {call.direction} · {call.language}
            </div>
          </div>
          <button className="btn" onClick={onClose} style={{ marginLeft: "auto", padding: "6px 12px" }}>
            Close
          </button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 14 }}>{call.summary}</div>

            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 16 }}
            >
              <Field label="Intent">{INTENT_LABELS[call.primaryIntent]}</Field>
              <Field label="Root cause">
                {ROOT_CAUSE_LABELS[call.rootCause]}
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{ROOT_CAUSE_OWNER[call.rootCause]}</div>
              </Field>
              <Field label="Resolution">
                {RESOLUTION_LABELS[call.resolution]}
                <div style={{ fontSize: 11.5, color: call.resolved ? "var(--delta-good)" : "var(--serious)" }}>
                  {call.resolved ? "resolved" : "open"}
                </div>
              </Field>
              <Field label="Predicted CSAT">
                <span className="num" style={{ fontSize: 17, fontWeight: 640 }}>
                  {call.csatPredicted}
                </span>
                <span style={{ color: "var(--text-muted)" }}> / 5</span>
              </Field>
            </div>

            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
              {call.rootCauseNote}
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>
                Sentiment across the call
              </div>
              <SentimentBar start={call.sentimentStart} end={call.sentimentEnd} />
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>
                Risk
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <RiskBar value={call.escalationRisk} label="Escalation" />
                <RiskBar value={call.churnRisk} label="Churn" />
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>
                Agent checklist {passed}/{compliance.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {compliance.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                    <span style={{ color: v ? "var(--good)" : "var(--critical)", fontWeight: 700, width: 12 }}>
                      {v ? "✓" : "✕"}
                    </span>
                    <span style={{ color: v ? "var(--text-secondary)" : "var(--text-primary)" }}>
                      {k.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {call.productSignal && (
            <div className="card" style={{ borderColor: "color-mix(in srgb, var(--critical) 35%, var(--border))" }}>
              <div className="card-head">
                <div className="card-title">Product signal</div>
                <span className="chip sev" data-level={call.productSignal.severity}>
                  {call.productSignal.severity}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 8 }}>{call.productSignal.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 5 }}>{call.productSignal.evidence}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
                Routed to {call.productSignal.owner}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>
              What would stop this call happening again
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{call.nextBestAction}</div>
            {call.policyFriction.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>
                  Policy friction
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {call.policyFriction.map((p) => (
                    <li key={p} style={{ marginBottom: 4 }}>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Transcript</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="chip">ASR WER ≈ {(call.asrWer * 100).toFixed(0)}%</span>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setShowJson((v) => !v)}>
                  {showJson ? "Transcript" : "Raw JSON"}
                </button>
              </div>
            </div>
            <p className="card-sub">
              Highlighted lines are the quotes the extraction pulled out. Turns marked low confidence are where
              speech-to-text is least sure — usually order numbers and heavy code-mixing.
            </p>

            {showJson ? (
              <pre
                className="mono"
                style={{
                  background: "var(--surface-2)",
                  padding: 14,
                  borderRadius: 8,
                  overflowX: "auto",
                  fontSize: 11,
                  lineHeight: 1.5,
                  margin: 0,
                  maxHeight: 460,
                }}
              >
                {JSON.stringify({ ...call, transcript: undefined }, null, 2)}
              </pre>
            ) : turns ? (
              <Transcript turns={turns} quotes={call.quotes} />
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "20px 0" }}>
                {transcriptsReady ? "No transcript stored for this call." : "Loading transcripts…"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: "var(--text-muted)" }}>
            <span className="chip">
              extracted by {call.extractedBy === "llm" ? `model${call.extractionMs ? ` · ${call.extractionMs}ms` : ""}` : call.extractedBy}
            </span>
            {call.refundAmountInr > 0 && <span className="chip">refund {inr(call.refundAmountInr)}</span>}
            {call.repeatCaller && <span className="chip">repeat caller</span>}
            {call.competitorMentions.map((c) => (
              <span className="chip" key={c}>
                mentioned {c}
              </span>
            ))}
            {call.tags.map((t) => (
              <span className="chip" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
