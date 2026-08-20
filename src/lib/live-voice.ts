import type { Turn } from "./types";

/**
 * Real-time voice, browser to Gemini and back.
 *
 * The Live API is a direct WebSocket from the page to Google, so the page needs
 * a credential. It gets a single-use ephemeral token from /api/voice-token
 * rather than the API key, which never leaves the server.
 *
 * Audio contracts, both non-negotiable and both easy to get subtly wrong:
 *   up   — raw PCM, signed 16-bit, mono, little-endian, 16 kHz
 *   down — raw PCM, signed 16-bit, mono, little-endian, 24 kHz
 *
 * The two rates differ, which is why capture and playback run on separate
 * AudioContexts instead of one shared one.
 */

export type VoiceStatus = "idle" | "connecting" | "live" | "closing" | "closed" | "error";

/** The slice of the SDK's Session we actually use, so the dynamic import does
 *  not drag its types through every call site. */
interface LiveSession {
  sendRealtimeInput: (input: { audio: { data: string; mimeType: string } }) => void;
  sendClientContent: (input: { turns: unknown[]; turnComplete: boolean }) => void;
  close: () => void;
}

export interface LiveVoiceCallbacks {
  onStatus: (status: VoiceStatus) => void;
  /** Finalised turns, in order. Replaced wholesale on each change. */
  onTurns: (turns: Turn[]) => void;
  /** Whatever is being said right now, before it becomes a turn. */
  onPartial: (speaker: "agent" | "customer", text: string) => void;
  /** Mic level 0-1, for the meter. */
  onLevel: (level: number) => void;
  /** Agent output level 0-1, so the UI can show who is speaking. */
  onAgentLevel: (level: number) => void;
  onError: (message: string) => void;
}

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class LiveVoiceSession {
  private cb: LiveVoiceCallbacks;
  private session: LiveSession | null = null;

  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;

  private playCtx: AudioContext | null = null;
  private playCursor = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private muted = false;

  private turns: Turn[] = [];
  private startedAt = 0;
  private pending: Record<"agent" | "customer", string> = { agent: "", customer: "" };

  private stopped = false;

  constructor(cb: LiveVoiceCallbacks) {
    this.cb = cb;
  }

  getTurns(): Turn[] {
    return this.turns;
  }

  async start(): Promise<void> {
    this.cb.onStatus("connecting");
    this.stopped = false;

    // 1. Credential --------------------------------------------------------
    const res = await fetch("/api/voice-token");
    const data = await res.json();
    if (!res.ok) throw new Error(data.hint ? `${data.error} ${data.hint}` : data.error || "Could not start a voice session.");

    // 2. Microphone, before the socket, so a denied permission fails fast ---
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });

    // 3. Socket ------------------------------------------------------------
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1alpha" } });

    this.session = (await ai.live.connect({
      model: data.model,
      // The heavy config lives on the token's constraints; sending a
      // conflicting copy here is rejected, so this stays minimal.
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onopen: () => {
          this.startedAt = Date.now();
          this.cb.onStatus("live");
        },
        onmessage: (msg: unknown) => this.handleMessage(msg),
        onerror: (e: ErrorEvent) => {
          this.cb.onError(e?.message || "The voice connection dropped.");
          this.cb.onStatus("error");
        },
        onclose: () => {
          if (!this.stopped) this.cb.onStatus("closed");
        },
      },
    })) as unknown as LiveSession;

    await this.startCapture();
    await this.startPlayback();

    // Native-audio models wait to be spoken to. A nudge makes Maya open the
    // call the way a real agent picks up, rather than sitting in silence.
    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "(The customer has just connected. Greet them now.)" }] }],
      turnComplete: true,
    });
  }

  // ------------------------------------------------------------------------

  private async startCapture() {
    const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
    this.captureCtx = ctx;
    await ctx.audioWorklet.addModule("/pcm-worklet.js");

    const source = ctx.createMediaStreamSource(this.micStream!);
    const node = new AudioWorkletNode(ctx, "pcm-worklet");
    this.worklet = node;

    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.stopped || !this.session) return;
      // Muting drops the audio here rather than gating the mic track, so the
      // socket stays warm and unmuting is instant.
      if (this.muted) {
        this.cb.onLevel(0);
        return;
      }
      const pcm = new Int16Array(e.data);

      let peak = 0;
      for (let i = 0; i < pcm.length; i += 8) {
        const v = Math.abs(pcm[i]) / 32768;
        if (v > peak) peak = v;
      }
      this.cb.onLevel(peak);

      this.session.sendRealtimeInput({
        audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${CAPTURE_RATE}` },
      });
    };

    source.connect(node);
    // A worklet with no destination is allowed to be garbage collected in some
    // engines. Routing it to a muted gain keeps the graph alive without
    // echoing the caller back into their own speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
  }

  private async startPlayback() {
    const ctx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    this.playCtx = ctx;
    // Autoplay policy: the context may start suspended until a gesture. The
    // call always begins from a click, so resuming here is safe.
    if (ctx.state === "suspended") await ctx.resume();
    this.playCursor = ctx.currentTime;

    // Tap the output so the UI can show that she is the one talking. Reading
    // the real signal beats inferring it from message timing, which lags.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    analyser.connect(ctx.destination);
    this.analyser = analyser;

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const sample = () => {
      if (this.stopped || !this.analyser) return;
      this.analyser.getByteTimeDomainData(bins);
      let peak = 0;
      for (let i = 0; i < bins.length; i += 2) {
        const v = Math.abs(bins[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      this.cb.onAgentLevel(peak);
      this.levelTimer = requestAnimationFrame(sample);
    };
    this.levelTimer = requestAnimationFrame(sample);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.cb.onLevel(0);
  }

  private enqueueAudio(b64: string) {
    const ctx = this.playCtx;
    if (!ctx) return;

    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (!pcm.length) return;

    const buffer = ctx.createBuffer(1, pcm.length, PLAYBACK_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser ?? ctx.destination);

    // Schedule back to back. Starting every chunk at currentTime would overlap
    // them and produce a stutter; this keeps the speech gapless.
    const startAt = Math.max(ctx.currentTime, this.playCursor);
    src.start(startAt);
    this.playCursor = startAt + buffer.duration;

    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
  }

  /** Barge-in: the model was cut off, so drop everything still queued. */
  private flushPlayback() {
    for (const src of this.playing) {
      try {
        src.stop();
      } catch {
        /* already finished */
      }
    }
    this.playing.clear();
    if (this.playCtx) this.playCursor = this.playCtx.currentTime;
  }

  // ------------------------------------------------------------------------

  private handleMessage(msg: unknown) {
    const m = msg as {
      serverContent?: {
        modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
        inputTranscription?: { text?: string };
        outputTranscription?: { text?: string };
        interrupted?: boolean;
        turnComplete?: boolean;
      };
    };
    const content = m?.serverContent;
    if (!content) return;

    if (content.interrupted) this.flushPlayback();

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.enqueueAudio(part.inlineData.data);
    }

    // Transcription arrives as fragments. A speaker's run is finalised when the
    // other one starts, which is the only reliable turn boundary the stream
    // gives us for the customer side.
    if (content.inputTranscription?.text) {
      this.flushPending("agent");
      this.pending.customer += content.inputTranscription.text;
      this.cb.onPartial("customer", this.pending.customer);
    }
    if (content.outputTranscription?.text) {
      this.flushPending("customer");
      this.pending.agent += content.outputTranscription.text;
      this.cb.onPartial("agent", this.pending.agent);
    }

    if (content.turnComplete) {
      this.flushPending("agent");
      this.flushPending("customer");
      this.cb.onPartial("agent", "");
    }
  }

  private flushPending(role: "agent" | "customer") {
    const text = this.pending[role].trim();
    if (!text) return;
    this.pending[role] = "";
    this.turns.push({
      role,
      text,
      tMs: Math.max(0, Date.now() - this.startedAt),
      // Native-audio transcription does not expose a per-turn confidence, so
      // this is a flat placeholder rather than an invented number.
      conf: 0.9,
    });
    this.cb.onTurns([...this.turns]);
  }

  // ------------------------------------------------------------------------

  async stop(): Promise<Turn[]> {
    if (this.stopped) return this.turns;
    this.stopped = true;
    this.cb.onStatus("closing");

    this.flushPending("agent");
    this.flushPending("customer");
    this.flushPlayback();

    if (this.levelTimer !== null) cancelAnimationFrame(this.levelTimer);
    this.levelTimer = null;
    this.analyser = null;

    try {
      this.session?.close();
    } catch {
      /* already closed */
    }
    this.session = null;

    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;

    await this.captureCtx?.close().catch(() => {});
    await this.playCtx?.close().catch(() => {});
    this.captureCtx = null;
    this.playCtx = null;

    this.cb.onStatus("closed");
    this.cb.onLevel(0);
    this.cb.onAgentLevel(0);
    return this.turns;
  }
}
