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

// Microphone -> rolling buffer -> a fresh window every hopSec. Nothing is stored or sent.
export class AudioEngine {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private proc?: ScriptProcessorNode;
  private buf: Float32Array[] = [];
  private len = 0;
  private timer?: number;
  private wake?: any;

  async start(onWindow: (audio: Float32Array) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const rate = this.ctx.sampleRate;
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const maxLen = rate * CONFIG.audio.windowSec;
    this.proc.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      this.buf.push(d); this.len += d.length;
      while (this.len - this.buf[0].length >= maxLen) this.len -= this.buf.shift()!.length;
    };
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    src.connect(this.proc); this.proc.connect(mute); mute.connect(this.ctx.destination);
    try { this.wake = await (navigator as any).wakeLock?.request("screen"); } catch {}
    this.timer = window.setInterval(() => {
      if (this.len < maxLen * 0.8) return; // wait for a mostly-full window
      const all = new Float32Array(this.len);
      let o = 0; for (const c of this.buf) { all.set(c, o); o += c.length; }
      onWindow(resample(all, rate, CONFIG.model.sampleRate));
    }, CONFIG.audio.hopSec * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.wake?.release?.();
    this.buf = []; this.len = 0;
  }

  // Tiny audio/haptic cues so the screen can stay in a pocket.
  beep(freq = 660, ms = 70, gain = 0.15) {
    if (!this.ctx) return;
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
