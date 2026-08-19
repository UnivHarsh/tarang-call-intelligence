"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { CallInsight } from "@/lib/types";
import { INTENTS, INTENT_LABELS, ROOT_CAUSES, ROOT_CAUSE_LABELS } from "@/lib/types";
import { dateTime, duration } from "@/lib/analytics";
import { CallDetail } from "@/components/call-detail";
import { Loading } from "@/components/loading";

type SortKey = "recent" | "csat" | "escalation" | "churn" | "duration";

const RISK_TONE = (v: number) => (v > 0.66 ? "var(--critical)" : v > 0.4 ? "var(--serious)" : "var(--text-muted)");

export default function CallsPage() {
  const { calls, loading, live } = useStore();

  const [q, setQ] = useState("");
  const [intent, setIntent] = useState("");
  const [cause, setCause] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<CallInsight | null>(null);

  const cities = useMemo(() => [...new Set(calls.map((c) => c.customer.city))].sort(), [calls]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = calls.filter((c) => {
      if (intent && c.primaryIntent !== intent) return false;
      if (cause && c.rootCause !== cause) return false;
      if (city && c.customer.city !== city) return false;
      if (status === "unresolved" && c.resolved) return false;
      if (status === "escalated" && c.contained) return false;
      if (status === "signal" && !c.productSignal) return false;
      if (status === "repeat" && !c.repeatCaller) return false;
      if (status === "churn" && c.churnRisk < 0.5) return false;
      if (status === "live" && c.extractedBy === "seed") return false;
      if (!needle) return true;
      return (
        c.summary.toLowerCase().includes(needle) ||
        c.customer.name.toLowerCase().includes(needle) ||
        c.id.includes(needle) ||
        c.tags.some((t) => t.includes(needle)) ||
        c.quotes.some((x) => x.text.toLowerCase().includes(needle)) ||
        (c.order?.id ?? "").toLowerCase().includes(needle) ||
        c.nextBestAction.toLowerCase().includes(needle)
      );
    });

    const cmp: Record<SortKey, (a: CallInsight, b: CallInsight) => number> = {
      recent: (a, b) => b.startedAt.localeCompare(a.startedAt),
      csat: (a, b) => a.csatPredicted - b.csatPredicted,
      escalation: (a, b) => b.escalationRisk - a.escalationRisk,
      churn: (a, b) => b.churnRisk - a.churnRisk,
      duration: (a, b) => b.durationSec - a.durationSec,
    };
    return [...out].sort(cmp[sort]);
  }, [calls, q, intent, cause, city, status, sort]);

  const reset = () => {
    setQ("");
    setIntent("");
    setCause("");
    setCity("");
    setStatus("");
  };

  const active = Boolean(q || intent || cause || city || status);

  if (loading) return <Loading label="Loading calls" />;

  return (
    <>
      <section style={{ padding: "30px 0 18px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Calls</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "70ch" }}>
          Every call in the corpus, with the extracted record attached. Search runs over summaries, quotes, tags, order
          IDs and the recommended action — not just the transcript, which is the point of extracting in the first place.
        </p>
      </section>

      {/* Filters sit in one row above the table. */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
          position: "sticky",
          top: 58,
          zIndex: 20,
          background: "var(--plane)",
          padding: "10px 0",
        }}
      >
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search calls, quotes, order IDs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search calls"
        />
        <select className="control" value={intent} onChange={(e) => setIntent(e.target.value)} aria-label="Filter by intent">
          <option value="">All intents</option>
          {INTENTS.map((i) => (
            <option key={i} value={i}>
              {INTENT_LABELS[i]}
            </option>
          ))}
        </select>
        <select className="control" value={cause} onChange={(e) => setCause(e.target.value)} aria-label="Filter by root cause">
          <option value="">All root causes</option>
          {ROOT_CAUSES.map((i) => (
            <option key={i} value={i}>
              {ROOT_CAUSE_LABELS[i]}
            </option>
          ))}
        </select>
        <select className="control" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Filter by city">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="control" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by flag">
          <option value="">Any status</option>
          <option value="unresolved">Unresolved</option>
          <option value="escalated">Escalated to human</option>
          <option value="signal">Has product signal</option>
          <option value="repeat">Repeat caller</option>
          <option value="churn">Churn risk over 50</option>
          {live.length > 0 && <option value="live">From my live demo</option>}
        </select>
        <select className="control" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="recent">Most recent</option>
          <option value="csat">Lowest CSAT</option>
          <option value="escalation">Highest escalation risk</option>
          <option value="churn">Highest churn risk</option>
          <option value="duration">Longest</option>
        </select>
        {active && (
          <button className="btn" style={{ padding: "6px 12px" }} onClick={reset}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--text-muted)" }} className="num">
          {filtered.length.toLocaleString("en-IN")} of {calls.length.toLocaleString("en-IN")}
        </span>
      </div>

      <div className="card card-pad-0 scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Customer</th>
              <th style={{ minWidth: 280 }}>What happened</th>
              <th>Root cause</th>
              <th style={{ textAlign: "right" }}>CSAT</th>
              <th style={{ textAlign: "right" }}>Esc</th>
              <th style={{ textAlign: "right" }}>Churn</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((c) => (
              <tr key={c.id} onClick={() => setOpen(c)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(c)}>
                <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: 12 }}>
                  {dateTime(c.startedAt)}
                  <div className="num" style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {duration(c.durationSec)}
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 550 }}>{c.customer.name}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                    {c.customer.city} · {c.customer.segment}
                  </div>
                </td>
                <td>
                  <div style={{ marginBottom: 3 }}>{c.summary}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="chip">{INTENT_LABELS[c.primaryIntent]}</span>
                    {c.productSignal && (
                      <span className="chip sev" data-level={c.productSignal.severity}>
                        signal
                      </span>
                    )}
                    {!c.contained && <span className="chip">handed off</span>}
                    {c.repeatCaller && <span className="chip">repeat</span>}
                    {c.extractedBy !== "seed" && (
                      <span className="chip" style={{ color: "var(--delta-good)" }}>
                        your call
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{ROOT_CAUSE_LABELS[c.rootCause]}</td>
                <td className="num" style={{ textAlign: "right", fontWeight: 620, color: c.csatPredicted <= 2 ? "var(--critical)" : undefined }}>
                  {c.csatPredicted}
                </td>
                <td className="num" style={{ textAlign: "right", color: RISK_TONE(c.escalationRisk) }}>
                  {(c.escalationRisk * 100).toFixed(0)}
                </td>
                <td className="num" style={{ textAlign: "right", color: RISK_TONE(c.churnRisk) }}>
                  {(c.churnRisk * 100).toFixed(0)}
                </td>
                <td style={{ color: "var(--text-muted)", textAlign: "right" }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No calls match these filters.
          </div>
        )}
      </div>

      {filtered.length > limit && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn" onClick={() => setLimit((l) => l + 100)}>
            Show 100 more ({(filtered.length - limit).toLocaleString("en-IN")} remaining)
          </button>
        </div>
      )}

      {open && <CallDetail call={open} onClose={() => setOpen(null)} />}
    </>
  );
}
