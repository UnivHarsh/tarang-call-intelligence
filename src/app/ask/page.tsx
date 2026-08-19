"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { CallInsight } from "@/lib/types";
import { CallDetail } from "@/components/call-detail";

const PRESETS = [
  "What got worse in the last two weeks, and who owns it?",
  "Overall CSAT looks flat. Is anything actually wrong underneath it?",
  "Which city should the ops team look at first, and why?",
  "What is the strongest evidence that the coupon problem is real and not user error?",
  "Which of these issues would you fix first with one engineer for one week?",
  "How much refund money is tied up in problems we already know about?",
];

interface Answer {
  answer: string;
  citations: string[];
  mode: "llm" | "demo";
  model?: string;
  note?: string;
  costUsd?: number;
}

export default function AskPage() {
  const { calls } = useStore();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CallInsight | null>(null);

  const byId = useMemo(() => new Map(calls.map((c) => [c.id, c])), [calls]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setQ(question);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAnswer(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  // Renders [c_0412] as a button that opens the call it cites.
  const withCitations = (text: string) =>
    text.split(/(\[c_\d{4}\]|\[live_[a-z0-9]+\])/g).map((part, i) => {
      const m = part.match(/^\[(.+)\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const call = byId.get(m[1]);
      if (!call) return <span key={i}>{part}</span>;
      return (
        <button
          key={i}
          onClick={() => setOpen(call)}
          title={call.summary}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 5,
            padding: "0 5px",
            fontSize: 11.5,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            color: "var(--series-1)",
            margin: "0 1px",
          }}
        >
          {m[1]}
        </button>
      );
    });

  return (
    <>
      <section style={{ padding: "30px 0 18px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Ask</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "72ch" }}>
          Questions in plain English, answered over all {calls.length.toLocaleString("en-IN")} calls. The aggregates are
          computed in code and handed to the model as a briefing — it does the reasoning and the writing, and never the
          arithmetic. Answers cite call IDs; click one to read the call.
        </p>
      </section>

      <div className="card" style={{ marginBottom: 16 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about the calls…"
            aria-label="Your question"
            style={{ fontSize: 13.5, padding: "9px 12px" }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !q.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className="chip"
              onClick={() => void ask(p)}
              disabled={busy}
              style={{
                cursor: busy ? "default" : "pointer",
                textAlign: "left",
                // .chip is nowrap by design; a whole question needs to wrap or
                // it drags the page wider than a phone screen.
                whiteSpace: "normal",
                maxWidth: "100%",
                lineHeight: 1.4,
                paddingTop: 5,
                paddingBottom: 5,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {busy && (
        <div className="card">
          <div className="skeleton" style={{ height: 14, width: "88%", marginBottom: 9 }} />
          <div className="skeleton" style={{ height: 14, width: "94%", marginBottom: 9 }} />
          <div className="skeleton" style={{ height: 14, width: "62%" }} />
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--critical) 35%, var(--border))" }}>
          <div className="card-title">Could not answer</div>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </div>
      )}

      {answer && !busy && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Answer</div>
            <div style={{ display: "flex", gap: 7 }}>
              <span className="chip">{answer.mode === "llm" ? (answer.model ?? "model") : "aggregates only"}</span>
              {typeof answer.costUsd === "number" && answer.costUsd > 0 && (
                <span className="chip">${answer.costUsd.toFixed(4)}</span>
              )}
            </div>
          </div>

          <div style={{ fontSize: 14, lineHeight: 1.62, marginTop: 12, whiteSpace: "pre-wrap", maxWidth: "76ch" }}>
            {withCitations(answer.answer)}
          </div>

          {answer.citations.length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
                Cited calls
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {answer.citations
                  .map((id) => byId.get(id))
                  .filter((c): c is CallInsight => Boolean(c))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setOpen(c)}
                      style={{
                        textAlign: "left",
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 7,
                        padding: "8px 11px",
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit",
                      }}
                    >
                      <div style={{ fontSize: 12.5 }}>{c.summary}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                        {c.id} · {c.customer.city} · CSAT {c.csatPredicted}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {answer.note && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 16, borderTop: "1px solid var(--grid)", paddingTop: 10 }}>
              {answer.note}
            </div>
          )}
        </div>
      )}

      {open && <CallDetail call={open} onClose={() => setOpen(null)} />}
    </>
  );
}
