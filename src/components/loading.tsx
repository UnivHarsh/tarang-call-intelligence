export function Loading({ label }: { label: string }) {
  return (
    <div style={{ padding: "56px 0" }}>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18 }}>{label}…</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 16 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 92 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 240 }} />
    </div>
  );
}
