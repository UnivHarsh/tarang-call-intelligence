/**
 * Microphone capture worklet.
 *
 * The Live API wants raw 16-bit PCM, mono, little-endian, at 16 kHz. The
 * browser hands us 32-bit floats at whatever rate the AudioContext actually
 * got — Chrome usually honours a requested 16000, Safari historically does not
 * and gives 44100 or 48000 instead. So this resamples rather than assuming,
 * because the failure mode of assuming is audio that sounds fine locally and
 * arrives chipmunked on a Mac.
 *
 * Runs on the audio thread, so it stays deliberately small: buffer, resample,
 * convert, post. No allocation in the hot path beyond the output chunk.
 */

const TARGET_RATE = 16000;
// ~128 ms per message. Small enough that the model feels responsive, large
// enough that we are not posting hundreds of tiny messages a second.
const CHUNK_SAMPLES = 2048;

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SAMPLES);
    this.filled = 0;
    // Fractional read position into the incoming block, carried across blocks
    // so the resampler does not click at every 128-frame boundary.
    this.cursor = 0;
    this.ratio = sampleRate / TARGET_RATE;
    this.tail = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    if (this.ratio === 1) {
      for (let i = 0; i < channel.length; i++) this.push(channel[i]);
      return true;
    }

    // Linear interpolation down to 16 kHz.
    let pos = this.cursor;
    while (pos < channel.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.tail : channel[i - 1];
      const b = channel[i];
      this.push(a + (b - a) * frac);
      pos += this.ratio;
    }
    this.cursor = pos - channel.length;
    this.tail = channel[channel.length - 1];
    return true;
  }

  push(sample) {
    this.buffer[this.filled++] = sample;
    if (this.filled < CHUNK_SAMPLES) return;

    const pcm = new Int16Array(CHUNK_SAMPLES);
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer rather than copy — this is the audio thread.
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this.filled = 0;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
