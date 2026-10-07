import { CONFIG } from "./config";

export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

export const rms = (a: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};

// Microphone -> rolling buffer -> a fresh window every hopSec. Nothing is stored or sent.
export class AudioEngine {
  ctx?: AudioContext;
  private stream?: MediaStream;
  private proc?: ScriptProcessorNode;
  private buf: Float32Array[] = [];
  private len = 0;
  private timer?: number;
  private wake?: any;
  private onVis = () => { if (!document.hidden) this.ctx?.resume(); };
  /** Resolves once the mic is live and the context is running. */
  ready: Promise<void> = Promise.resolve();

  /** MUST be called synchronously from a tap/click: mobile browsers keep AudioContext suspended otherwise. */
  prepare(): Promise<void> {
    this.ctx = new AudioContext();
    const resumed = this.ctx.resume();
    this.ready = (async () => {
      await resumed;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = this.ctx!;
      if (ctx.state !== "running") await ctx.resume();
      const maxLen = ctx.sampleRate * CONFIG.audio.windowSec;
      const src = ctx.createMediaStreamSource(this.stream);
      this.proc = ctx.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (e) => {
        const d = new Float32Array(e.inputBuffer.getChannelData(0));
        this.buf.push(d); this.len += d.length;
        while (this.len - this.buf[0].length >= maxLen) this.len -= this.buf.shift()!.length;
      };
      const mute = ctx.createGain(); mute.gain.value = 0;
      src.connect(this.proc); this.proc.connect(mute); mute.connect(ctx.destination);
      document.addEventListener("visibilitychange", this.onVis);
      try { this.wake = await (navigator as any).wakeLock?.request("screen"); } catch {}
    })();
    this.ready.catch(() => {});
    return this.ready;
  }

  /** Emit the latest window every hopSec (call after `ready`). */
  listen(onWindow: (audio: Float32Array) => void) {
    const rate = this.ctx!.sampleRate, maxLen = rate * CONFIG.audio.windowSec;
    this.timer = window.setInterval(() => {
      if (this.len < maxLen * 0.8) return;
      const all = new Float32Array(this.len);
      let o = 0; for (const c of this.buf) { all.set(c, o); o += c.length; }
      onWindow(resample(all, rate, CONFIG.model.sampleRate));
    }, CONFIG.audio.hopSec * 1000);
  }

  info() {
    const s = this.stream?.getAudioTracks()[0]?.getSettings();
    return { state: this.ctx?.state ?? "none", rate: this.ctx?.sampleRate ?? 0, track: s?.sampleRate ?? 0 };
  }

  stop() {
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVis);
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.wake?.release?.();
    this.buf = []; this.len = 0;
  }

  // Tiny audio/haptic cues so the screen can stay in a pocket.
  beep(freq = 660, ms = 70, gain = 0.15) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + ms / 1000);
    o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + ms / 1000);
  }
  chime() {
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 400, 0.2), i * 160));
    navigator.vibrate?.([80, 60, 80, 60, 200]);
  }
  pulse() { navigator.vibrate?.(25); }
}

/** Scale a window toward a target RMS (capped gain) so quiet streams and loud streets look alike to the model. */
export function normalize(a: Float32Array, target = 0.05, maxGain = 10): Float32Array {
  const r = rms(a);
  if (r < 1e-6) return a;
  const g = Math.min(maxGain, target / r), out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(-1, Math.min(1, a[i] * g));
  return out;
}

/** Tiny UI sounds, only used when the mic is not running. Never required. */
export function sfx(kind: "seal" | "open") {
  try {
    const ctx = new AudioContext(), t = ctx.currentTime, g = ctx.createGain();
    g.connect(ctx.destination);
    if (kind === "seal") {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g); o.start(t); o.stop(t + 0.2);
    } else {
      const n = Math.floor(ctx.sampleRate * 0.35), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = b; f.type = "highpass"; f.frequency.value = 2500; g.gain.value = 0.12;
      s.connect(f); f.connect(g); s.start(t);
    }
    setTimeout(() => ctx.close(), 600);
  } catch {}
}
