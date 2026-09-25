"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import {
  computeKpis, emergingIssues, recedingIssues, stackedByRootCause, weeklySeries, distribution,
  cityWeekRates, deflectionModel, metricCsat, metricContainment, inr, ROOT_CAUSE_TEST, shortDate, NOW, WEEK,
  clusterSignals,
  type Emerging,
} from "@/lib/analytics";
import { INTENT_LABELS, ROOT_CAUSE_LABELS } from "@/lib/types";
import { BarList, Heatmap, LineChart, StackedColumns, StatTile, Sparkline, seriesColor } from "@/components/charts";
import { ShiftList } from "@/components/shift-list";
import { Loading } from "@/components/loading";

export default function Overview() {
  const { calls, loading, error, meta, live } = useStore();
  const [focus, setFocus] = useState<string | null>(null);
  const [mapPick, setMapPick] = useState<Emerging | null>(null);

  // The three things buried in the corpus. They lead the page because a dashboard
  // should open with what it found, not with a description of itself.
  const signals = useMemo(() => (calls.length ? clusterSignals(calls).slice(0, 3) : []), [calls]);

  const kpis = useMemo(() => (calls.length ? computeKpis(calls) : []), [calls]);
  const emerging = useMemo(() => (calls.length ? emergingIssues(calls) : []), [calls]);
  const receding = useMemo(() => (calls.length ? recedingIssues(calls) : []), [calls]);
  const stack = useMemo(() => (calls.length ? stackedByRootCause(calls) : null), [calls]);
  const csatSeries = useMemo(() => (calls.length ? weeklySeries(calls, metricCsat) : []), [calls]);
  const containSeries = useMemo(() => (calls.length ? weeklySeries(calls, metricContainment) : []), [calls]);
  const intents = useMemo(() => (calls.length ? distribution(calls, (c) => c.primaryIntent, INTENT_LABELS, 7) : []), [calls]);
  const causes = useMemo(() => (calls.length ? distribution(calls, (c) => c.rootCause, ROOT_CAUSE_LABELS, 7) : []), [calls]);
  const deflection = useMemo(() => (calls.length ? deflectionModel(calls) : []), [calls]);

  // The map follows whatever signal is selected, defaulting to the strongest
  // one rather than a hard-wired root cause. If the data changes, so does this.
  const mapDefault = useMemo(
    () => [...emerging].sort((a, b) => b.recentCount - a.recentCount)[0] ?? receding[0] ?? null,
    [emerging, receding],
  );
  const mapped = mapPick ?? mapDefault;
  const heat = useMemo(() => {
    if (!calls.length || !mapped) return null;
    return cityWeekRates(calls, ROOT_CAUSE_TEST(mapped.id));
  }, [calls, mapped]);

  const totals = useMemo(() => {
    const secs = calls.reduce((a, c) => a + c.durationSec, 0);
    return {
      calls: calls.length,
      hours: secs / 3600,
      refunds: calls.reduce((a, c) => a + c.refundAmountInr, 0),
    };
  }, [calls]);

  if (loading) return <Loading label="Loading the call corpus" />;
  if (error)
    return (
      <div className="card" style={{ marginTop: 32 }}>
        <div className="card-title">Could not load the corpus</div>
        <p className="card-sub">{error}</p>
      </div>
    );

  return (
    <>
      <section style={{ padding: "34px 0 26px" }}>
        <div className="eyebrow">Kartly · customer support · last 8 weeks</div>
        <h1 style={{ fontSize: 27, fontWeight: 660, letterSpacing: "-0.025em", margin: "10px 0 8px", maxWidth: "30ch" }}>
          {signals.length
            ? `${signals.length} things are quietly costing this business money.`
            : "Every support call, read in full."}
        </h1>
        <p style={{ color: "var(--text-secondary)", maxWidth: "62ch", margin: 0 }}>
          A support team listens to about 2% of its calls. These came out of reading all of them.
        </p>

        {signals.length > 0 && (
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 20 }}
          >
            {signals.map((s) => (
              <Link
                key={s.title}
                href="/signals"
                className="card"
                style={{ display: "block", textDecoration: "none", color: "inherit", padding: "14px 16px" }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 7, flexWrap: "wrap" }}>
                  <span className="chip sev" data-level={s.severity}>{s.severity}</span>
                  <span className="chip">{s.owner}</span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 620, lineHeight: 1.32, marginBottom: 8 }}>{s.title}</div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                  <div className="stat-label" style={{ lineHeight: 1.45 }}>
                    {s.count} calls
                    {s.refundExposure > 0 && <> · {inr(s.refundExposure)} at risk</>}
                    <br />
                    since {shortDate(s.firstSeen)}
                  </div>
                  <Sparkline data={s.weeklyCounts} width={74} height={26} />
                </div>
              </Link>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 28, marginTop: 24 }}>
          <div>
            <div className="hero-figure">{totals.calls.toLocaleString("en-IN")}</div>
            <div className="stat-label" style={{ marginTop: 2 }}>
              calls analysed · {totals.hours.toFixed(0)} hours of audio
              {live.length > 0 && (
                <span style={{ color: "var(--delta-good)", fontWeight: 600 }}> · {live.length} from your live demo</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingBottom: 6 }}>
            <Link className="btn btn-primary" href="/live">
              Take a live call
            </Link>
            <Link className="btn" href="/how">
              How it works
            </Link>
          </div>
        </div>
      </section>

      {/*
        Who actually opens this, and what they do differently afterwards.
        Without it the dashboard is a pile of charts; with it every number above
        has a person attached to it, which is the difference between a demo and
        something a team adopts.
      */}
      <section
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 26 }}
      >
        {[
          {
            team: "Support ops",
            uses: "Signals and Calls",
            does: "Stops triaging the same complaint twice. One incident, one owner, the calls behind it attached.",
          },
          {
            team: "Product",
            uses: "Signals and Ask",
            does: "Gets the bug report the support queue never files, with the week it started and the platform it is on.",
          },
          {
            team: "Growth and CX leadership",
            uses: "Overview",
            does: "Sees which root cause is rising this week before it shows up in churn, not after.",
          },
        ].map((r) => (
          <div key={r.team} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 640, marginBottom: 3 }}>{r.team}</div>
            <div className="stat-label" style={{ marginBottom: 7 }}>lives in {r.uses}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>{r.does}</div>
          </div>
        ))}
      </section>

      <div
        className="eyebrow"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}
      >
        <span>Week of {shortDate(NOW - WEEK)}</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
          deltas are against the previous week
        </span>
      </div>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 26 }}>
        {kpis.map((k) => (
          <StatTile
            key={k.key}
            label={k.label}
            value={k.display}
            delta={k.delta}
            deltaDisplay={k.deltaDisplay}
            goodWhen={k.goodWhen}
            spark={k.spark}
            hint={k.hint}
          />
        ))}
      </section>

      {/* ---------------------------------------------------------------- */}

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <div className="card-title">What changed in the last two weeks</div>
          <span className="chip">rate-based · z ≥ 2.5</span>
        </div>
        <p className="card-sub">
          Each row compares the last 14 days against the 28 days before them, as a <em>share</em> of call volume rather than
          a raw count — volume is growing, so counts alone would flag everything as rising. A two-proportion z-test then
          drops the jumps that are just small numbers moving around. Click a row to map it.
        </p>

        <div className="eyebrow" style={{ margin: "16px 0 2px", color: "var(--critical)" }}>
          Getting worse
        </div>
        <ShiftList items={emerging} direction="up" onSelect={setMapPick} selectedId={mapped?.id ?? null} />

        <div className="eyebrow" style={{ margin: "24px 0 2px", color: "var(--delta-good)" }}>
          Getting better
        </div>
        <ShiftList items={receding} direction="down" onSelect={setMapPick} selectedId={mapped?.id ?? null} />
      </section>

      {/* ---------------------------------------------------------------- */}

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", marginBottom: 18 }}>
        <div className="card">
          <div className="card-title">Call volume by root cause</div>
          <p className="card-sub">
            Root cause, not intent — intent says what the customer asked for, root cause says which team owns the fix.
          </p>
          {stack && <StackedColumns rows={stack.rows} keys={stack.keys} labels={stack.labels} />}
        </div>

        <div className="card">
          <div className="card-title">Predicted CSAT</div>
          <p className="card-sub">
            Flat at the top line — which is the trap. The averages hide the segment underneath; the heatmap below is where
            it shows up.
          </p>
          <LineChart data={csatSeries} valueName="Predicted CSAT" format={(v) => v.toFixed(1)} domain={[1, 5]} />
        </div>
      </section>

      {heat && mapped && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">
            <div className="card-title">{mapped.label.split(" — ")[0]} — share of each city&rsquo;s calls, by week</div>
            <span className="chip">{mapPick ? "your selection" : "widest signal"}</span>
          </div>
          <p className="card-sub">
            Normalised per city, so a big city does not simply look worse than a small one. Darker means a larger share of
            that city&rsquo;s own call volume.
          </p>
          <Heatmap labels={heat.labels} rows={heat.rows} />
        </section>
      )}

      {/* ---------------------------------------------------------------- */}

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 18 }}>
        <div className="card">
          <div className="card-title">Why people call</div>
          <p className="card-sub">Primary intent, all 8 weeks.</p>
          <BarList
            items={intents}
            colorIndex={0}
            selected={focus}
            onSelect={(k) => setFocus(focus === k ? null : k)}
          />
        </div>

        <div className="card">
          <div className="card-title">What actually caused it</div>
          <p className="card-sub">Root cause, all 8 weeks. This is the list that turns into tickets.</p>
          <BarList items={causes} colorIndex={0} />
        </div>

        <div className="card">
          <div className="card-title">Agent containment</div>
          <p className="card-sub">Share of calls finished without a human handoff.</p>
          <LineChart
            data={containSeries}
            valueName="Contained"
            format={(v) => `${v.toFixed(0)}%`}
            colorIndex={2}
            height={168}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Where the volume should go</div>
        <p className="card-sub">
          The split that matters for a support strategy: calls that should never have happened, calls the agent can finish,
          and calls that genuinely need a person.
        </p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          {deflection.map((d, i) => (
            <div key={d.label} style={{ borderLeft: `3px solid ${seriesColor(i)}`, paddingLeft: 13 }}>
              <div className="num" style={{ fontSize: 22, fontWeight: 640, letterSpacing: "-0.02em" }}>
                {(d.share * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 13, fontWeight: 580, marginTop: 1 }}>{d.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{d.note}</div>
              <div className="num" style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 5 }}>
                {d.calls.toLocaleString("en-IN")} calls
              </div>
            </div>
          ))}
        </div>
      </section>

      <p style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: "76ch", marginTop: 26 }}>
        {meta?.brandNote} The corpus is {meta?.totalCalls.toLocaleString("en-IN")} synthetic calls across{" "}
        {meta?.totalTurns.toLocaleString("en-IN")} conversational turns, generated deterministically from a seeded script
        library so the numbers on this page are reproducible. {inr(totals.refunds)} of refund value is discussed across the
        corpus.
      </p>
    </>
  );
}
