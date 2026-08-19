"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Hand-rolled SVG charts.
 *
 * Specs held constant across every chart here: marks are thin (columns capped at
 * 24px), data-ends are 4px-rounded and square at the baseline, lines are 2px,
 * markers are r>=4 with a 2px surface ring, area washes sit at 10% opacity, and
 * gridlines are solid hairlines one step off the surface. Series colours are
 * assigned from a fixed slot order and never cycled — a ninth category folds
 * into "Other" instead of inventing a hue.
 *
 * There is no dual-axis chart anywhere in this project, by design.
 */

export const SERIES = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

export const seriesColor = (i: number) => SERIES[i] ?? "var(--text-muted)";

// ---------------------------------------------------------------------------

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

interface TipState {
  x: number;
  y: number;
  node: React.ReactNode;
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  const flipX = typeof window !== "undefined" && tip.x > window.innerWidth - 220;
  return (
    <div
      className="tooltip"
      style={{
        left: flipX ? tip.x - 200 : tip.x + 14,
        top: Math.max(8, tip.y - 12),
      }}
      role="presentation"
    >
      {tip.node}
    </div>
  );
}

function TipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "space-between", marginTop: 2 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
        {color && <span className="legend-swatch" style={{ background: color }} />}
        {label}
      </span>
      <span className="num" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

// ---------------------------------------------------------------------------
// Single-series line chart with an area wash. One measure, one axis.
// ---------------------------------------------------------------------------

export interface LinePoint {
  label: string;
  value: number;
  n?: number;
}

export function LineChart({
  data,
  format = (v: number) => String(Math.round(v)),
  height = 190,
  colorIndex = 0,
  yFloorZero = true,
  domain,
  valueName,
}: {
  data: LinePoint[];
  format?: (v: number) => string;
  height?: number;
  colorIndex?: number;
  yFloorZero?: boolean;
  /** Pin the axis to the metric's real scale (e.g. [1,5] for a 1-5 rating). */
  domain?: [number, number];
  valueName: string;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pad = { top: 12, right: 46, bottom: 26, left: 40 };
  const w = Math.max(width, 260);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = data.map((d) => d.value);
  const rawMax = Math.max(...values, 0);
  const rawMin = values.length ? Math.min(...values) : 0;

  // A rating has a real scale, so plot it on that scale. Auto-zooming a 1-5
  // metric to its own 0.3-point range turns noise into a mountain range, which
  // is the opposite of what a flat trend should look like.
  let lo: number;
  let hi: number;
  let ticks: number[];
  if (domain) {
    [lo, hi] = domain;
    ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  } else if (yFloorZero) {
    lo = 0;
    ticks = niceTicks(rawMax * 1.08);
    hi = Math.max(ticks[ticks.length - 1] ?? rawMax, rawMax) || 1;
  } else {
    const padY = (rawMax - rawMin) * 0.4 || 1;
    lo = Math.max(0, rawMin - padY);
    hi = rawMax + padY;
    ticks = niceTicks(hi).filter((t) => t >= lo);
    if (!ticks.length) ticks = [lo, hi];
  }

  const x = (i: number) => pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const color = seriesColor(colorIndex);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const i = Math.round(((px - pad.left) / (innerW || 1)) * (data.length - 1));
      const idx = Math.max(0, Math.min(data.length - 1, i));
      setHoverIdx(idx);
      setTip({
        x: e.clientX,
        y: e.clientY,
        node: (
          <>
            <div style={{ fontWeight: 620, marginBottom: 3 }}>Week of {data[idx].label}</div>
            <TipRow label={valueName} value={format(data[idx].value)} color={color} />
            {data[idx].n !== undefined && <TipRow label="Calls in week" value={String(data[idx].n)} />}
          </>
        ),
      });
    },
    [data, format, innerW, pad.left, color, valueName],
  );

  const last = data.length - 1;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg
        width={w}
        height={height}
        role="img"
        aria-label={`${valueName} by week`}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setTip(null);
          setHoverIdx(null);
        }}
        style={{ display: "block", touchAction: "none" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={pad.left - 8} y={y(t) + 3.5} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}

        {/*
          The area wash reads as "quantity accumulated from zero". On a pinned
          scale like a 1-5 rating the baseline is not zero, so filling down to
          it would overstate the metric. Line only in that case.
        */}
        {!domain && <path d={area} fill={color} opacity={0.1} />}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hoverIdx !== null && (
          <line className="axis-line" x1={x(hoverIdx)} x2={x(hoverIdx)} y1={pad.top} y2={pad.top + innerH} />
        )}

        {data.map((d, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(d.value)}
            r={hoverIdx === i ? 5 : 3.5}
            fill={color}
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
        ))}

        {/* Selective direct label: only the endpoint. */}
        <text
          className="axis-text"
          x={x(last) + 9}
          y={y(data[last].value) + 3.5}
          style={{ fill: "var(--text-primary)", fontWeight: 640, fontSize: 11.5 }}
        >
          {format(data[last].value)}
        </text>

        <line className="axis-line" x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} />

        {data.map((d, i) =>
          i % Math.ceil(data.length / 6) === 0 || i === last ? (
            <text key={i} className="axis-text" x={x(i)} y={height - 8} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked columns. 2px surface gap between segments; only the top segment of a
// stack gets the rounded data-end.
// ---------------------------------------------------------------------------

export interface StackRow {
  label: string;
  values: Record<string, number>;
  total: number;
}

export function StackedColumns({
  rows,
  keys,
  labels,
  height = 230,
}: {
  rows: StackRow[];
  keys: string[];
  labels: Record<string, string>;
  height?: number;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Three of the light-mode categorical steps sit below 3:1 against the light
  // surface. The palette validator flags that as needing relief, so the same
  // numbers are always reachable as a table rather than only as colour.
  const [asTable, setAsTable] = useState(false);

  const pad = { top: 12, right: 12, bottom: 26, left: 40 };
  const w = Math.max(width, 280);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(...rows.map((r) => r.total), 1);
  const ticks = niceTicks(max * 1.08);
  const hi = Math.max(ticks[ticks.length - 1] ?? max, max);

  const band = innerW / rows.length;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.top + innerH - (v / hi) * innerH;

  if (asTable) {
    return (
      <div ref={ref} style={{ width: "100%" }}>
        <div className="scroll-x" style={{ maxHeight: height + 60, overflowY: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Week</th>
                {keys.map((k) => (
                  <th key={k} style={{ textAlign: "right" }}>
                    {labels[k] ?? k}
                  </th>
                ))}
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ cursor: "default" }}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.label}</td>
                  {keys.map((k) => (
                    <td key={k} className="num" style={{ textAlign: "right" }}>
                      {r.values[k] ?? 0}
                    </td>
                  ))}
                  <td className="num" style={{ textAlign: "right", fontWeight: 620 }}>
                    {r.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn" style={{ padding: "4px 10px", fontSize: 12, marginTop: 10 }} onClick={() => setAsTable(false)}>
          Show chart
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={height} role="img" aria-label="Weekly call volume by root cause" style={{ display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={pad.left - 8} y={y(t) + 3.5} textAnchor="end">
              {t}
            </text>
          </g>
        ))}

        {rows.map((row, ri) => {
          const cx = pad.left + band * ri + band / 2;
          let acc = 0;
          const segs = keys
            .map((k) => {
              const v = row.values[k] ?? 0;
              const seg = { k, v, y0: acc, y1: acc + v };
              acc += v;
              return seg;
            })
            .filter((s) => s.v > 0);

          return (
            <g
              key={row.label}
              onMouseEnter={() => setHover(ri)}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  node: (
                    <>
                      <div style={{ fontWeight: 620, marginBottom: 4 }}>Week of {row.label}</div>
                      {[...segs].reverse().map((s) => (
                        <TipRow
                          key={s.k}
                          label={labels[s.k] ?? s.k}
                          value={String(s.v)}
                          color={seriesColor(keys.indexOf(s.k))}
                        />
                      ))}
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 5, paddingTop: 4 }}>
                        <TipRow label="Total" value={String(row.total)} />
                      </div>
                    </>
                  ),
                })
              }
              onMouseLeave={() => {
                setTip(null);
                setHover(null);
              }}
            >
              <rect x={cx - band / 2} y={pad.top} width={band} height={innerH} fill="transparent" />
              {segs.map((s, si) => {
                const top = y(s.y1);
                const bottom = y(s.y0);
                const isTop = si === segs.length - 1;
                // 2px surface gap does the separating; no strokes on marks.
                const h = Math.max(0, bottom - top - (si === 0 ? 0 : 2));
                const yy = top;
                if (h <= 0) return null;
                const r = Math.min(4, h / 2);
                const d = isTop
                  ? `M${cx - barW / 2},${yy + r} a${r},${r} 0 0 1 ${r},${-r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} h${-barW} Z`
                  : `M${cx - barW / 2},${yy} h${barW} v${h} h${-barW} Z`;
                return (
                  <path
                    key={s.k}
                    d={d}
                    fill={seriesColor(keys.indexOf(s.k))}
                    opacity={hover === null || hover === ri ? 1 : 0.35}
                  />
                );
              })}
            </g>
          );
        })}

        <line className="axis-line" x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} />

        {rows.map((r, i) => (
          <text key={r.label} className="axis-text" x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle">
            {r.label}
          </text>
        ))}
      </svg>

      <div className="legend">
        {keys.map((k, i) => (
          <span className="legend-item" key={k}>
            <span className="legend-swatch" style={{ background: seriesColor(i) }} />
            {labels[k] ?? k}
          </span>
        ))}
        <button
          onClick={() => setAsTable(true)}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            padding: 0,
            fontSize: 11.5,
            color: "var(--text-muted)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          View as table
        </button>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar list. One measure, one colour — length already encodes size,
// so a value-ramp here would double-encode and burn the free channel.
// ---------------------------------------------------------------------------

export function BarList({
  items,
  format = (n: number) => String(n),
  colorIndex = 0,
  onSelect,
  selected,
}: {
  items: { key: string; label: string; count: number; share: number }[];
  format?: (n: number) => string;
  colorIndex?: number;
  onSelect?: (key: string) => void;
  selected?: string | null;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const color = seriesColor(colorIndex);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((it) => {
        const active = selected === it.key;
        const Cmp = onSelect ? "button" : "div";
        return (
          <Cmp
            key={it.key}
            {...(onSelect
              ? { onClick: () => onSelect(it.key), type: "button" as const }
              : {})}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 10,
              alignItems: "center",
              background: "transparent",
              border: "none",
              padding: "2px 0",
              textAlign: "left",
              cursor: onSelect ? "pointer" : "default",
              opacity: selected && !active ? 0.5 : 1,
              width: "100%",
            }}
            title={onSelect ? `Filter to ${it.label}` : undefined}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-primary)",
                  marginBottom: 4,
                  fontWeight: active ? 620 : 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.label}
              </div>
              <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(it.count / max) * 100}%`,
                    height: "100%",
                    background: color,
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              </div>
            </div>
            <div className="num" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 62, textAlign: "right" }}>
              {format(it.count)}
              <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {(it.share * 100).toFixed(0)}%</span>
            </div>
          </Cmp>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — de-emphasised trend, current period accented.
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  width = 78,
  height = 24,
  colorIndex = 0,
}: {
  data: number[];
  width?: number;
  height?: number;
  colorIndex?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * (width - 6) + 3;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={path} fill="none" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r={2.6} fill={seriesColor(colorIndex)} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Heatmap — sequential, one hue light to dark, with a scale legend.
// ---------------------------------------------------------------------------

const SEQ = ["var(--seq-100)", "var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)"];

export function Heatmap({
  labels,
  rows,
  unit = "%",
  minN = 8,
}: {
  labels: string[];
  rows: { city: string; cells: { value: number; n: number; hits: number }[] }[];
  unit?: string;
  /** Cells thinner than this are shown as no-read rather than as a percentage. */
  minN?: number;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  // A city-week holding four calls can read 25% off a single call. Those cells
  // are excluded from the scale and from the render, because otherwise the
  // brightest tiles on the map are its emptiest ones.
  const max = Math.max(...rows.flatMap((r) => r.cells.filter((c) => c.n >= minN).map((c) => c.value)), 0.0001);

  // A row with no readable cell in it is a row of dashes. It carries nothing
  // and costs a line of the reader's attention, so it is summarised instead.
  const readable = rows.filter((r) => r.cells.some((c) => c.n >= minN));
  const omitted = rows.length - readable.length;
  const step = (v: number) => {
    if (v <= 0) return "var(--surface-2)";
    const i = Math.min(SEQ.length - 1, Math.floor((v / max) * SEQ.length));
    return SEQ[i];
  };

  return (
    <div>
      <div className="scroll-x">
        <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 11.5, minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0 8px 4px 0", color: "var(--text-muted)", fontWeight: 600 }} />
              {labels.map((l) => (
                <th key={l} style={{ padding: "0 0 4px", color: "var(--text-muted)", fontWeight: 600, minWidth: 40 }}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {readable.map((r) => (
              <tr key={r.city}>
                <td style={{ padding: "0 10px 0 0", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>{r.city}</td>
                {r.cells.map((c, i) => {
                  const thin = c.n < minN;
                  return (
                    <td key={i} style={{ padding: 0 }}>
                      <div
                        onMouseEnter={(e) =>
                          setTip({
                            x: e.clientX,
                            y: e.clientY,
                            node: (
                              <>
                                <div style={{ fontWeight: 620, marginBottom: 3 }}>
                                  {r.city} · week of {labels[i]}
                                </div>
                                {thin ? (
                                  <div style={{ color: "var(--text-secondary)", maxWidth: 190 }}>
                                    Only {c.n} call{c.n === 1 ? "" : "s"} from this city that week. Too few to read a rate
                                    from.
                                  </div>
                                ) : (
                                  <>
                                    <TipRow label="Share of city calls" value={`${c.value.toFixed(1)}${unit}`} />
                                    <TipRow label="Matching calls" value={`${c.hits} of ${c.n}`} />
                                  </>
                                )}
                              </>
                            ),
                          })
                        }
                        onMouseLeave={() => setTip(null)}
                        style={{
                          height: 26,
                          borderRadius: 3,
                          background: thin ? "transparent" : step(c.value),
                          border: thin ? "1px dashed var(--grid)" : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: !thin && c.value / max > 0.55 ? "#fff" : "var(--text-muted)",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 10.5,
                        }}
                      >
                        {thin ? "·" : c.value >= 0.5 ? c.value.toFixed(0) : "0"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>0{unit}</span>
        <div style={{ display: "flex", gap: 2 }}>
          {SEQ.map((c) => (
            <div key={c} style={{ width: 22, height: 8, background: c, borderRadius: 2 }} />
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {max.toFixed(0)}{unit} of that city&rsquo;s calls
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ width: 14, height: 9, border: "1px dashed var(--grid)", borderRadius: 2 }} />
          under {minN} calls — not read
          {omitted > 0 && ` · ${omitted} ${omitted === 1 ? "city" : "cities"} too small to chart`}
        </span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentiment ribbon — diverging, warm/cool poles with a neutral midpoint.
// ---------------------------------------------------------------------------

export function SentimentBar({ start, end }: { start: number; end: number }) {
  const pos = (v: number) => ((v + 1) / 2) * 100;
  const improved = end > start;
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: "linear-gradient(90deg, var(--series-8) 0%, var(--surface-2) 50%, var(--series-1) 100%)",
          opacity: 0.9,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${pos(start)}%`,
            top: -2,
            width: 3,
            height: 12,
            background: "var(--text-muted)",
            borderRadius: 2,
            transform: "translateX(-50%)",
          }}
          title={`Start ${start.toFixed(2)}`}
        />
        <div
          style={{
            position: "absolute",
            left: `${pos(end)}%`,
            top: -4,
            width: 10,
            height: 16,
            background: improved ? "var(--good)" : "var(--critical)",
            border: "2px solid var(--surface-1)",
            borderRadius: 5,
            transform: "translateX(-50%)",
          }}
          title={`End ${end.toFixed(2)}`}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-muted)", marginTop: 5 }}>
        <span>negative</span>
        <span>
          {start.toFixed(2)} → <strong style={{ color: improved ? "var(--delta-good)" : "var(--critical)" }}>{end.toFixed(2)}</strong>
        </span>
        <span>positive</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  delta,
  deltaDisplay,
  goodWhen,
  spark,
  hint,
}: {
  label: string;
  value: string;
  delta: number | null;
  deltaDisplay: string | null;
  goodWhen: "up" | "down";
  spark: number[];
  hint?: string;
}) {
  const dir =
    delta === null || Math.abs(delta) < 1e-9
      ? "flat"
      : (delta > 0 && goodWhen === "up") || (delta < 0 && goodWhen === "down")
        ? "good"
        : "bad";

  return (
    <div className="card" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: 7 }}>
        {/* The comparison period is named once above the row rather than
            repeated on all six tiles, where it wraps and crowds out the value. */}
        {delta !== null ? (
          <span className="delta" data-dir={dir} style={{ whiteSpace: "nowrap" }}>
            {dir === "flat" ? "—" : delta > 0 ? "▲" : "▼"} {deltaDisplay}
          </span>
        ) : (
          <span />
        )}
        <Sparkline data={spark} colorIndex={0} width={64} height={20} />
      </div>
    </div>
  );
}

export function useIsomorphicReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
