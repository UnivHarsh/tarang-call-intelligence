"use client";

import { useEffect, useRef, useState } from "react";

export type CallPhase = "idle" | "connecting" | "live" | "ended";

/**
 * The call itself.
 *
 * Deliberately shaped like a phone call rather than a developer demo: one
 * subject, one primary action, and no chrome competing with it. Everything that
 * is not the call — transcripts, extracted fields, alternative inputs — lives
 * outside this component, so that during a call there is exactly one thing on
 * screen.
 */

const BARS = 28;

function Waveform({ level, active, tone }: { level: number; active: boolean; tone: string }) {
  const [, force] = useState(0);
  const phase = useRef(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      phase.current += 0.16;
      force((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, height: 44 }} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => {
        // A fixed envelope keeps the middle taller than the edges, so silence
        // reads as a resting line rather than a flat dead row.
        const envelope = Math.sin((i / (BARS - 1)) * Math.PI);
        const wobble = active ? (Math.sin(phase.current + i * 0.55) + 1) / 2 : 0;
        const h = 3 + envelope * (3 + level * 38 * (0.45 + wobble * 0.55));
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: Math.max(3, h),
              borderRadius: 2,
              background: tone,
              opacity: active ? 0.35 + envelope * 0.5 : 0.16,
              transition: "height 90ms linear, opacity 200ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

function Avatar({ level, phase }: { level: number; phase: CallPhase }) {
  const speaking = phase === "live" && level > 0.06;
  const ring = phase === "connecting" || speaking;

  return (
    <div style={{ position: "relative", width: 108, height: 108, display: "grid", placeItems: "center" }}>
      {ring && (
        <>
          <span className="call-ring" style={{ animationDelay: "0ms" }} />
          <span className="call-ring" style={{ animationDelay: "700ms" }} />
        </>
      )}
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(150deg, var(--series-1), color-mix(in srgb, var(--series-7) 70%, var(--series-1)))",
          color: "#fff",
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          transform: speaking ? `scale(${1 + Math.min(0.06, level * 0.14)})` : "scale(1)",
          transition: "transform 110ms ease-out",
          boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
        }}
      >
        M
      </div>
    </div>
  );
}

function RoundButton({
  onClick,
  label,
  tone,
  children,
  disabled,
}: {
  onClick: () => void;
  label: string;
  tone: "call" | "end" | "neutral" | "neutral-on";
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const bg =
    tone === "call" ? "var(--good)"
    : tone === "end" ? "var(--critical)"
    : tone === "neutral-on" ? "var(--text-primary)"
    : "var(--surface-2)";
  const fg = tone === "neutral" ? "var(--text-primary)" : tone === "neutral-on" ? "var(--surface-1)" : "#fff";
  const size = tone === "call" || tone === "end" ? 60 : 48;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: tone === "neutral" ? "1px solid var(--border-strong)" : "none",
        background: bg,
        color: fg,
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "transform 120ms ease, filter 120ms ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.94)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </button>
  );
}

const PhoneIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"
      fill="currentColor"
    />
  </svg>
);

const EndIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ transform: "rotate(135deg)" }}>
    <path
      d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z"
      fill="currentColor"
    />
  </svg>
);

const MicIcon = ({ off }: { off: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    {off && <path d="M4 3l16 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);

export function CallStage({
  phase,
  micLevel,
  agentLevel,
  seconds,
  muted,
  canCall,
  caption,
  onStart,
  onEnd,
  onToggleMute,
}: {
  phase: CallPhase;
  micLevel: number;
  agentLevel: number;
  seconds: number;
  muted: boolean;
  canCall: boolean;
  caption: { speaker: "agent" | "customer"; text: string } | null;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}) {
  const agentSpeaking = agentLevel > 0.06;
  const level = agentSpeaking ? agentLevel : micLevel;
  const tone = agentSpeaking ? "var(--series-1)" : "var(--good)";

  const status =
    phase === "connecting" ? "Calling…"
    : phase === "live" ? (agentSpeaking ? "Maya is speaking" : muted ? "Muted" : "Listening…")
    : "Kartly Support · AI agent";

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="call-stage">
      <Avatar level={agentSpeaking ? agentLevel : micLevel} phase={phase} />

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.015em" }}>Maya</div>
        <div
          style={{
            fontSize: 13,
            color: phase === "live" && agentSpeaking ? "var(--series-1)" : "var(--text-secondary)",
            marginTop: 3,
            transition: "color 200ms ease",
          }}
        >
          {status}
        </div>
        {phase === "live" && (
          <div className="num" style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
            {mmss}
          </div>
        )}
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 320,
          height: phase === "live" ? 44 : 12,
          marginTop: phase === "live" ? 20 : 14,
          opacity: phase === "live" ? 1 : 0,
          overflow: "hidden",
          transition: "height 260ms ease, opacity 220ms ease, margin-top 260ms ease",
        }}
      >
        <Waveform level={level} active={phase === "live"} tone={tone} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 10 }}>
        {phase === "live" ? (
          <>
            <RoundButton onClick={onToggleMute} label={muted ? "Unmute" : "Mute"} tone={muted ? "neutral-on" : "neutral"}>
              <MicIcon off={muted} />
            </RoundButton>
            <RoundButton onClick={onEnd} label="End call and analyse" tone="end">
              <EndIcon />
            </RoundButton>
          </>
        ) : (
          <RoundButton
            onClick={onStart}
            label="Call Maya"
            tone="call"
            disabled={!canCall || phase === "connecting"}
          >
            <PhoneIcon />
          </RoundButton>
        )}
      </div>

      {phase !== "live" && phase !== "connecting" && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 14 }}>
          {canCall ? "Press to call. Speak normally — she will answer." : "Voice is off on this deployment."}
        </div>
      )}

      {/* Live caption. One line, large, the way a call app shows it. */}
      <div className="call-caption" data-visible={Boolean(caption && phase === "live")}>
        {caption && (
          <>
            <span style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", fontWeight: 620 }}>
              {caption.speaker === "agent" ? "MAYA" : "YOU"}
            </span>
            <div style={{ fontSize: 15, lineHeight: 1.5, marginTop: 4 }}>{caption.text}</div>
          </>
        )}
      </div>
    </div>
  );
}
