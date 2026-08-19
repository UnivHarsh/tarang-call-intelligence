"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { CallInsight } from "@/lib/types";
import { clusterSignals, fullDate, inr, shortDate, weekBuckets } from "@/lib/analytics";
import { Sparkline } from "@/components/charts";
import { CallDetail } from "@/components/call-detail";
import { Loading } from "@/components/loading";

export default function SignalsPage() {
  const { calls, loading } = useStore();
  const [open, setOpen] = useState<CallInsight | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const signals = useMemo(() => (calls.length ? clusterSignals(calls) : []), [calls]);
  const weekLabels = useMemo(() => (calls.length ? weekBuckets(calls).map((b) => shortDate(b.start)) : []), [calls]);
  const byId = useMemo(() => new Map(calls.map((c) => [c.id, c])), [calls]);

  const totalCalls = signals.reduce((a, s) => a + s.count, 0);
  const totalExposure = signals.reduce((a, s) => a + s.refundExposure, 0);

  if (loading) return <Loading label="Clustering signals" />;

  return (
    <>
      <section style={{ padding: "30px 0 20px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Product signals</h1>
        <p style={{ color: "var(--text-secondary)", margin: 0, maxWidth: "72ch" }}>
          The extraction only raises a signal when a call says something that would still be true for other customers — a
          coupon that fails on one platform, a batch with a defect, a status that is silently wrong. One customer having a
          bad day is not a signal. These are then clustered by title, so a hundred calls become the handful of things
          somebody could actually go and fix.
        </p>

        <div style={{ display: "flex", gap: 30, marginTop: 22, flexWrap: "wrap" }}>
          <div>
            <div className="hero-figure" style={{ fontSize: 40 }}>
              {signals.length}
            </div>
            <div className="stat-label">distinct signals</div>
          </div>
          <div>
            <div className="hero-figure" style={{ fontSize: 40 }}>
              {totalCalls}
            </div>
            <div className="stat-label">calls behind them</div>
          </div>
          <div>
            <div className="hero-figure" style={{ fontSize: 40 }}>
              {inr(totalExposure)}
            </div>
            <div className="stat-label">refund value on those calls</div>
          </div>
        </div>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {signals.map((s) => {
          const recent = s.weeklyCounts.slice(-2).reduce((a, b) => a + b, 0);
          const prior = s.weeklyCounts.slice(-4, -2).reduce((a, b) => a + b, 0);
          const trend = prior === 0 ? (recent > 0 ? "new" : "flat") : recent > prior * 1.3 ? "up" : recent < prior * 0.7 ? "down" : "flat";
          const isOpen = expanded === s.title;

          return (
            <div className="card" key={s.title}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 340px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                    <span className="chip sev" data-level={s.severity}>
                      {s.severity}
                    </span>
                    <span className="chip">{s.owner}</span>
                    {trend === "up" && (
                      <span className="chip" style={{ color: "var(--critical)", borderColor: "var(--critical)" }}>
                        accelerating
                      </span>
                    )}
                    {trend === "down" && (
                      <span className="chip" style={{ color: "var(--delta-good)" }}>
                        receding
                      </span>
                    )}
                    {trend === "new" && <span className="chip">new</span>}
                  </div>

                  <div style={{ fontSize: 15.5, fontWeight: 620, letterSpacing: "-0.01em", marginBottom: 6 }}>{s.title}</div>

                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", maxWidth: "72ch" }}>{s.evidence[0]}</div>

                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 9 }}>
                    First seen {fullDate(s.firstSeen)} · most recent {fullDate(s.lastSeen)} · {inr(s.refundExposure)} in refunds on
                    these calls
                  </div>
                </div>

                <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em" }}>
                      {s.count}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>calls</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em" }}>
                      {recent}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>last 2 wks</div>
                  </div>
                  <div>
                    <Sparkline data={s.weeklyCounts} width={96} height={34} colorIndex={0} />
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", marginTop: 2 }}>
                      {weekLabels[0]} – {weekLabels[weekLabels.length - 1]}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--grid)", marginTop: 14, paddingTop: 12 }}>
                <button
                  className="btn"
                  style={{ padding: "5px 11px", fontSize: 12 }}
                  onClick={() => setExpanded(isOpen ? null : s.title)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? "Hide evidence" : `Evidence — ${s.callIds.length} recent calls`}
                </button>

                {isOpen && (
                  <div style={{ marginTop: 14 }}>
                    {s.evidence.length > 1 && (
                      <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 12.5, color: "var(--text-secondary)" }}>
                        {s.evidence.slice(1).map((e) => (
                          <li key={e} style={{ marginBottom: 4 }}>
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {s.callIds
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
                              borderRadius: 8,
                              padding: "10px 12px",
                              cursor: "pointer",
                              font: "inherit",
                              color: "inherit",
                            }}
                          >
                            <div style={{ fontSize: 12.5, marginBottom: 4 }}>
                              {c.quotes[0] ? `“${c.quotes[0].text}”` : c.summary}
                            </div>
                            <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {c.id} · {c.customer.city} · CSAT {c.csatPredicted} · {fullDate(Date.parse(c.startedAt))}
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {signals.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          No product signals in this corpus.
        </div>
      )}

      {open && <CallDetail call={open} onClose={() => setOpen(null)} />}
    </>
  );
}
