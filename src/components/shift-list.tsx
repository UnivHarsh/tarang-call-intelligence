"use client";

import type { Emerging } from "@/lib/analytics";
import { Sparkline } from "./charts";

export function ShiftList({
  items,
  direction,
  onSelect,
  selectedId,
}: {
  items: Emerging[];
  direction: "up" | "down";
  onSelect?: (e: Emerging) => void;
  selectedId?: string | null;
}) {
  if (!items.length) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
        Nothing clears the significance bar in this direction.
      </p>
    );
  }

  const accent = direction === "up" ? "var(--critical)" : "var(--delta-good)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {items.map((e, i) => {
        const selected = selectedId === e.id;
        const Row = onSelect ? "button" : "div";
        return (
          <Row
            key={e.id}
            {...(onSelect ? { type: "button" as const, onClick: () => onSelect(e) } : {})}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto auto auto",
              gap: 16,
              alignItems: "center",
              padding: "11px 8px",
              margin: "0 -8px",
              borderTop: i === 0 ? "none" : "1px solid var(--grid)",
              background: selected ? "var(--surface-2)" : "transparent",
              border: "none",
              borderRadius: selected ? 6 : 0,
              textAlign: "left",
              width: "calc(100% + 16px)",
              cursor: onSelect ? "pointer" : "default",
              font: "inherit",
              color: "inherit",
            }}
            title={onSelect ? "Show this on the map below" : undefined}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="chip-dot"
                  style={{
                    background: direction === "down" ? "var(--good)" : i === 0 ? "var(--critical)" : i < 3 ? "var(--serious)" : "var(--axis)",
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, paddingLeft: 15 }}>
                {e.dimension} · owner: {e.owner} · {e.recentCount} calls in the {direction === "up" ? "last 14 days" : "prior window"}
              </div>
            </div>

            <Sparkline data={e.spark} width={72} colorIndex={0} />

            <div style={{ textAlign: "right", minWidth: 100 }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 640 }}>
                {e.baseRate.toFixed(1)}% → {e.recentRate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>of all calls</div>
            </div>

            <div style={{ textAlign: "right", minWidth: 72 }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 640, color: accent }}>
                {e.lift === Infinity ? (direction === "up" ? "new" : "gone") : `${e.lift.toFixed(1)}×`}
              </div>
              <div className="num" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                z = {e.z.toFixed(1)}
              </div>
            </div>
          </Row>
        );
      })}
    </div>
  );
}
