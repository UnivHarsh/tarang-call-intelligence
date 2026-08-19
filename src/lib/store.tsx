"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CallInsight, Turn } from "./types";

/**
 * The corpus is split into two payloads on purpose.
 *
 * index.json carries every insight field but no transcripts — that is all the
 * dashboard ever reads, and it is ~35% of the bytes. transcripts.json is fetched
 * lazily in the background after first paint, because nothing on the landing
 * view needs a single word of dialogue. Shipping them together would make the
 * first chart wait on ~1.5MB of text nobody has asked to read yet.
 */

const LIVE_KEY = "tarang.liveCalls.v1";

interface StoreValue {
  calls: CallInsight[];
  seeded: CallInsight[];
  live: CallInsight[];
  transcripts: Record<string, Turn[]>;
  loading: boolean;
  transcriptsReady: boolean;
  error: string | null;
  meta: CorpusMeta | null;
  addLiveCall: (c: CallInsight, transcript: Turn[]) => void;
  clearLive: () => void;
  getTranscript: (c: CallInsight) => Turn[] | null;
}

export interface CorpusMeta {
  brand: string;
  brandNote: string;
  totalCalls: number;
  totalTurns: number;
  weeks: number;
  scenarios: number;
  corpusEnd: string;
  evalIds: string[];
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [seeded, setSeeded] = useState<CallInsight[]>([]);
  const [meta, setMeta] = useState<CorpusMeta | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Turn[]>>({});
  const [transcriptsReady, setTranscriptsReady] = useState(false);
  const [live, setLive] = useState<CallInsight[]>([]);
  const [liveTranscripts, setLiveTranscripts] = useState<Record<string, Turn[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [idxRes, metaRes] = await Promise.all([fetch("/data/index.json"), fetch("/data/meta.json")]);
        if (!idxRes.ok) throw new Error(`corpus index responded ${idxRes.status}`);
        const idx: CallInsight[] = await idxRes.json();
        const m: CorpusMeta = await metaRes.json();
        if (cancelled) return;
        setSeeded(idx);
        setMeta(m);
        setLoading(false);

        // Behind first paint.
        const tRes = await fetch("/data/transcripts.json");
        const t = await tRes.json();
        if (cancelled) return;
        setTranscripts(t);
        setTranscriptsReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the call corpus.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Live calls survive a reload so a demo can be picked up where it left off.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { calls: CallInsight[]; transcripts: Record<string, Turn[]> };
      setLive(parsed.calls ?? []);
      setLiveTranscripts(parsed.transcripts ?? {});
    } catch {
      /* a corrupt cache is not worth breaking the page over */
    }
  }, []);

  const persist = useCallback((calls: CallInsight[], tx: Record<string, Turn[]>) => {
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({ calls, transcripts: tx }));
    } catch {
      /* quota — the in-memory copy still works for this session */
    }
  }, []);

  const addLiveCall = useCallback(
    (c: CallInsight, transcript: Turn[]) => {
      setLive((prev) => {
        const next = [...prev.filter((x) => x.id !== c.id), c];
        setLiveTranscripts((pt) => {
          const nt = { ...pt, [c.id]: transcript };
          persist(next, nt);
          return nt;
        });
        return next;
      });
    },
    [persist],
  );

  const clearLive = useCallback(() => {
    setLive([]);
    setLiveTranscripts({});
    try {
      localStorage.removeItem(LIVE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  const getTranscript = useCallback(
    (c: CallInsight) => liveTranscripts[c.id] ?? transcripts[c.id] ?? null,
    [transcripts, liveTranscripts],
  );

  const calls = useMemo(
    () => [...seeded, ...live].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [seeded, live],
  );

  const value: StoreValue = {
    calls,
    seeded,
    live,
    transcripts,
    loading,
    transcriptsReady,
    error,
    meta,
    addLiveCall,
    clearLive,
    getTranscript,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
