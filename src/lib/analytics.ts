import type { CallInsight, Intent, RootCause } from "./types";
import { ROOT_CAUSE_LABELS, INTENT_LABELS, ROOT_CAUSE_OWNER } from "./types";

export const DAY = 86400000;
export const WEEK = 7 * DAY;

/** The demo timeline is fixed so the dashboard reads the same on any day. */
export const NOW = Date.parse("2026-08-20T00:00:00.000Z");

export const ts = (c: CallInsight) => Date.parse(c.startedAt);

// ---------------------------------------------------------------------------
// Time bucketing
// ---------------------------------------------------------------------------

export interface Bucket {
  start: number;
  end: number;
  label: string;
  calls: CallInsight[];
}

export function weekBuckets(calls: CallInsight[], weeks = 8, end = NOW): Bucket[] {
  const out: Bucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = end - (i + 1) * WEEK;
    const bEnd = start + WEEK;
    out.push({
      start,
      end: bEnd,
      label: shortDate(start),
      calls: calls.filter((c) => {
        const t = ts(c);
        return t >= start && t < bEnd;
      }),
    });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fullDate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dateTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Headline metrics
// ---------------------------------------------------------------------------

export interface Kpi {
  key: string;
  label: string;
  value: number;
  display: string;
  /** Direction that counts as an improvement. */
  goodWhen: "up" | "down";
  delta: number | null;
  deltaDisplay: string | null;
  spark: number[];
  hint: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (xs: CallInsight[], f: (c: CallInsight) => boolean) =>
  xs.length ? xs.filter(f).length / xs.length : 0;

export function computeKpis(calls: CallInsight[]): Kpi[] {
  const buckets = weekBuckets(calls);
  const last = buckets[buckets.length - 1]?.calls ?? [];
  const prev = buckets[buckets.length - 2]?.calls ?? [];

  const spark = (f: (b: CallInsight[]) => number) => buckets.map((b) => f(b.calls));

  const mk = (
    key: string,
    label: string,
    f: (cs: CallInsight[]) => number,
    fmt: (n: number) => string,
    goodWhen: "up" | "down",
    hint: string,
    deltaFmt?: (n: number) => string,
  ): Kpi => {
    const value = f(last);
    const before = prev.length ? f(prev) : null;
    const delta = before === null ? null : value - before;
    return {
      key,
      label,
      value,
      display: fmt(value),
      goodWhen,
      delta,
      deltaDisplay:
        delta === null ? null : (deltaFmt ?? fmt)(Math.abs(delta)),
      spark: spark(f),
      hint,
    };
  };

  return [
    mk("volume", "Calls this week", (cs) => cs.length, (n) => String(Math.round(n)), "down",
      "Contact volume for the most recent full week. Falling is usually good — it means fewer reasons to call."),
    mk("containment", "Contained by agent", (cs) => rate(cs, (c) => c.contained) * 100, (n) => `${n.toFixed(0)}%`, "up",
      "Share of calls the voice agent finished without handing off to a human."),
    mk("csat", "Predicted CSAT", (cs) => mean(cs.map((c) => c.csatPredicted)), (n) => n.toFixed(2), "up",
      "Model-predicted satisfaction, 1-5. Predicted rather than surveyed, so it covers 100% of calls instead of the ~8% who answer a survey."),
    mk("escalation", "High escalation risk", (cs) => rate(cs, (c) => c.escalationRisk > 0.6) * 100, (n) => `${n.toFixed(0)}%`, "down",
      "Calls where the customer is close to demanding a supervisor, a refund beyond policy, or a public complaint."),
    mk("refund", "Refund value discussed", (cs) => cs.reduce((a, c) => a + c.refundAmountInr, 0), (n) => inr(n), "down",
      "Rupee value of refunds requested or initiated on calls this week."),
    mk("aht", "Avg handle time", (cs) => mean(cs.map((c) => c.durationSec)), (n) => `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`, "down",
      "Average call duration including hold time.",
      (n) => `${Math.round(n)}s`),
  ];
}

export function inr(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

// ---------------------------------------------------------------------------
// Emerging issues
// ---------------------------------------------------------------------------

export interface Emerging {
  id: string;
  /** Calls behind this segment in the recent window, used to deduplicate
   *  segments that are different names for the same underlying calls. */
  recentIds: Set<string>;
  dimension: string;
  label: string;
  owner: string;
  recentCount: number;
  recentRate: number;
  baseRate: number;
  lift: number;
  z: number;
  spark: number[];
  sampleCallIds: string[];
}

/**
 * Compares the last two weeks against the four weeks before them.
 *
 * Two decisions matter here:
 *  - It compares RATES per 100 calls, not raw counts. Total volume grows week on
 *    week, so raw counts would flag every category as "emerging".
 *  - It runs a two-proportion z-test and keeps the z score in the output, so a
 *    jump from 2 calls to 5 does not get to look like a trend. Anything below
 *    z ≈ 2.5 is noise and is filtered out.
 */
export function emergingIssues(calls: CallInsight[], end = NOW): Emerging[] {
  return detectShifts(calls, "up", end);
}

/**
 * The same test run the other way. A fix that worked looks exactly like a
 * regression in reverse, and a dashboard that only shows things getting worse
 * quietly teaches its readers that nothing they do ever helps.
 */
export function recedingIssues(calls: CallInsight[], end = NOW): Emerging[] {
  return detectShifts(calls, "down", end);
}

function detectShifts(calls: CallInsight[], direction: "up" | "down", end = NOW): Emerging[] {
  const recentStart = end - 2 * WEEK;
  const baseStart = end - 6 * WEEK;

  const recent = calls.filter((c) => ts(c) >= recentStart && ts(c) < end);
  const base = calls.filter((c) => ts(c) >= baseStart && ts(c) < recentStart);
  if (recent.length < 20 || base.length < 20) return [];

  const segments = new Map<string, { dimension: string; label: string; owner: string; test: (c: CallInsight) => boolean }>();

  const seen = new Set<string>();
  for (const c of calls) {
    const rc = c.rootCause;
    if (!seen.has(`rc:${rc}`)) {
      seen.add(`rc:${rc}`);
      segments.set(`rc:${rc}`, {
        dimension: "Root cause",
        label: ROOT_CAUSE_LABELS[rc],
        owner: ROOT_CAUSE_OWNER[rc],
        test: (x) => x.rootCause === rc,
      });
    }
    const key = `rc-city:${rc}|${c.customer.city}`;
    if (!seen.has(key)) {
      seen.add(key);
      const city = c.customer.city;
      segments.set(key, {
        dimension: "Root cause × city",
        label: `${ROOT_CAUSE_LABELS[rc]} — ${city}`,
        owner: ROOT_CAUSE_OWNER[rc],
        test: (x) => x.rootCause === rc && x.customer.city === city,
      });
    }
    const ikey = `intent-city:${c.primaryIntent}|${c.customer.city}`;
    if (!seen.has(ikey)) {
      seen.add(ikey);
      const it = c.primaryIntent;
      const city = c.customer.city;
      segments.set(ikey, {
        dimension: "Intent × city",
        label: `${INTENT_LABELS[it]} — ${city}`,
        owner: "CS Ops",
        test: (x) => x.primaryIntent === it && x.customer.city === city,
      });
    }
  }

  const buckets = weekBuckets(calls, 8, end);
  const out: Emerging[] = [];

  for (const [id, seg] of segments) {
    const rHits = recent.filter(seg.test);
    const bHits = base.filter(seg.test);

    const p1 = rHits.length / recent.length;
    const p2 = bHits.length / base.length;

    // Whichever window is supposed to be the "before" needs enough calls in it
    // to have been a real thing in the first place.
    const anchor = direction === "up" ? rHits.length : bHits.length;
    if (anchor < 8) continue;
    if (direction === "up" ? p1 <= p2 : p2 <= p1) continue;

    const pooled = (rHits.length + bHits.length) / (recent.length + base.length);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / recent.length + 1 / base.length));
    const zRaw = se > 0 ? (p1 - p2) / se : 0;
    const z = Math.abs(zRaw);
    if (z < 2.5) continue;

    out.push({
      id,
      recentIds: new Set(rHits.map((c) => c.id)),
      dimension: seg.dimension,
      label: seg.label,
      owner: seg.owner,
      recentCount: direction === "up" ? rHits.length : bHits.length,
      recentRate: p1 * 100,
      baseRate: p2 * 100,
      lift: direction === "up" ? (p2 > 0 ? p1 / p2 : Infinity) : p1 > 0 ? p2 / p1 : Infinity,
      z,
      spark: buckets.map((b) => b.calls.filter(seg.test).length),
      sampleCallIds: rHits.slice(-4).map((c) => c.id),
    });
  }

  // Deduplicate by the calls behind each segment, not by the label.
  //
  // "Cold chain" and "Damaged / spoiled — Mumbai" are different names for
  // substantially the same calls, and a panel that lists both is telling the
  // reader one thing twice while burying whatever should have been in the
  // second slot. Strongest segment wins; anything whose calls are mostly
  // already accounted for is dropped.
  out.sort((a, b) => b.z - a.z);
  const kept: Emerging[] = [];
  for (const e of out) {
    const covered = kept.some((k) => {
      let shared = 0;
      for (const id of e.recentIds) if (k.recentIds.has(id)) shared++;
      return shared / Math.min(e.recentIds.size, k.recentIds.size) > 0.6;
    });
    if (!covered) kept.push(e);
  }
  return kept.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Product signals
// ---------------------------------------------------------------------------

export interface SignalCluster {
  title: string;
  owner: string;
  severity: "low" | "medium" | "high";
  count: number;
  firstSeen: number;
  lastSeen: number;
  weeklyCounts: number[];
  evidence: string[];
  callIds: string[];
  refundExposure: number;
}

export function clusterSignals(calls: CallInsight[], end = NOW): SignalCluster[] {
  const map = new Map<string, CallInsight[]>();
  for (const c of calls) {
    if (!c.productSignal) continue;
    const k = c.productSignal.title;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(c);
  }
  const buckets = weekBuckets(calls, 8, end);

  return [...map.entries()]
    .map(([title, cs]) => {
      const sorted = [...cs].sort((a, b) => ts(a) - ts(b));
      const sev = cs.some((c) => c.productSignal!.severity === "high")
        ? "high"
        : cs.some((c) => c.productSignal!.severity === "medium")
          ? "medium"
          : "low";
      return {
        title,
        owner: cs[0].productSignal!.owner,
        severity: sev as "low" | "medium" | "high",
        count: cs.length,
        firstSeen: ts(sorted[0]),
        lastSeen: ts(sorted[sorted.length - 1]),
        weeklyCounts: buckets.map((b) => b.calls.filter((c) => c.productSignal?.title === title).length),
        evidence: [...new Set(cs.map((c) => c.productSignal!.evidence))].slice(0, 3),
        callIds: sorted.slice(-6).map((c) => c.id),
        refundExposure: cs.reduce((a, c) => a + c.refundAmountInr, 0),
      };
    })
    .sort((a, b) => b.weeklyCounts.slice(-2).reduce((x, y) => x + y, 0) - a.weeklyCounts.slice(-2).reduce((x, y) => x + y, 0));
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

export interface Slice {
  key: string;
  label: string;
  count: number;
  share: number;
}

export function distribution<K extends string>(
  calls: CallInsight[],
  get: (c: CallInsight) => K,
  labels: Record<string, string>,
  topN = 7,
): Slice[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const k = get(c);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = all.slice(0, topN);
  const tail = all.slice(topN);
  const total = calls.length || 1;
  const out: Slice[] = head.map(([k, n]) => ({ key: k, label: labels[k] ?? k, count: n, share: n / total }));
  if (tail.length) {
    const n = tail.reduce((a, b) => a + b[1], 0);
    out.push({ key: "__other", label: `Other (${tail.length})`, count: n, share: n / total });
  }
  return out;
}

/** Weekly stacked series for the top N root causes, with the tail folded in. */
export function stackedByRootCause(calls: CallInsight[], topN = 6, end = NOW) {
  const buckets = weekBuckets(calls, 8, end);
  const totals = new Map<RootCause, number>();
  for (const c of calls) totals.set(c.rootCause, (totals.get(c.rootCause) ?? 0) + 1);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);

  const keys = [...top.map(String), "__other"];
  const labels: Record<string, string> = Object.fromEntries(top.map((k) => [k, ROOT_CAUSE_LABELS[k]]));
  labels["__other"] = "Other";

  const rows = buckets.map((b) => {
    const row: Record<string, number> = {};
    for (const k of top) row[k] = b.calls.filter((c) => c.rootCause === k).length;
    row["__other"] = b.calls.filter((c) => !top.includes(c.rootCause)).length;
    return { label: b.label, start: b.start, values: row, total: b.calls.length };
  });

  return { keys, labels, rows };
}

/** Weekly series of a scalar metric, for the single-series line charts. */
export function weeklySeries(
  calls: CallInsight[],
  f: (cs: CallInsight[]) => number,
  end = NOW,
): { label: string; start: number; value: number; n: number }[] {
  return weekBuckets(calls, 8, end).map((b) => ({
    label: b.label,
    start: b.start,
    value: b.calls.length ? f(b.calls) : 0,
    n: b.calls.length,
  }));
}

export const metricContainment = (cs: CallInsight[]) => rate(cs, (c) => c.contained) * 100;
export const metricCsat = (cs: CallInsight[]) => mean(cs.map((c) => c.csatPredicted));
export const metricVolume = (cs: CallInsight[]) => cs.length;
export const metricAht = (cs: CallInsight[]) => mean(cs.map((c) => c.durationSec));

/** City × week grid for the heatmap. Values are calls per 100, not raw counts. */
export function cityWeekRates(calls: CallInsight[], test: (c: CallInsight) => boolean, end = NOW) {
  const buckets = weekBuckets(calls, 8, end);
  const cities = [...new Set(calls.map((c) => c.customer.city))];
  const rows = cities
    .map((city) => {
      const cells = buckets.map((b) => {
        const inCity = b.calls.filter((c) => c.customer.city === city);
        const hits = inCity.filter(test).length;
        return { value: inCity.length ? (hits / inCity.length) * 100 : 0, n: inCity.length, hits };
      });
      return { city, cells, total: cells.reduce((a, b) => a + b.hits, 0) };
    })
    .sort((a, b) => b.total - a.total);
  return { labels: buckets.map((b) => b.label), rows };
}

// ---------------------------------------------------------------------------
// Deflection / cost model
// ---------------------------------------------------------------------------

export interface CostRow {
  label: string;
  calls: number;
  share: number;
  note: string;
}

/**
 * Splits contact volume into the three buckets a support-strategy conversation
 * actually turns on: calls that should never have happened, calls the agent can
 * finish, and calls that genuinely need a person.
 */
export function deflectionModel(calls: CallInsight[]): CostRow[] {
  const total = calls.length || 1;
  const deflectable = calls.filter((c) => c.tags.includes("deflectable")).length;
  const contained = calls.filter((c) => c.contained && !c.tags.includes("deflectable")).length;
  const human = calls.filter((c) => !c.contained).length;
  return [
    {
      label: "Should never have been a call",
      calls: deflectable,
      share: deflectable / total,
      note: "Status checks and address edits — the answer already existed in the app.",
    },
    {
      label: "Agent finished it",
      calls: contained,
      share: contained / total,
      note: "Real issues resolved end to end without a human.",
    },
    {
      label: "Needed a person",
      calls: human,
      share: human / total,
      note: "Policy exceptions, repeat escalations, and cases the agent could not complete.",
    },
  ];
}

export function pct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function duration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Turns an emerging-issue id back into a predicate, dropping any city qualifier.
 * The heatmap wants the issue across all cities — the city is the thing it is
 * about to reveal, so baking it into the filter would beg the question.
 */
export function ROOT_CAUSE_TEST(id: string): (c: CallInsight) => boolean {
  const [kind, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  const base = rest.split("|")[0];
  if (kind === "intent-city") return (c) => c.primaryIntent === (base as Intent);
  return (c) => c.rootCause === (base as RootCause);
}
