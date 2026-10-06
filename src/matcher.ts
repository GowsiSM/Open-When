import { CONFIG } from "./config";
import { conditionPhrase } from "./card";

// The rest of the app only knows this interface. Swap the model by swapping the class.
export interface AudioMatcher {
  load(onProgress?: (pct: number) => void): Promise<void>;
  /** audio: mono Float32 at CONFIG.model.sampleRate. Returns 0..1. */
  match(audio: Float32Array, condition: string): Promise<number>;
}

// Local open-weight CLAP via Transformers.js. Audio never leaves the device.
export class ClapMatcher implements AudioMatcher {
  private clf: any;
  async load(onProgress?: (pct: number) => void) {
    const { pipeline } = await import("@huggingface/transformers");
    this.clf = await (pipeline as any)("zero-shot-audio-classification", CONFIG.model.id, {
      progress_callback: (p: any) => p?.progress != null && onProgress?.(Math.round(p.progress)),
    });
  }
  async match(audio: Float32Array, condition: string) {
    const phrase = conditionPhrase(condition);
    const rivals = CONFIG.negatives.filter((n) => !phrase.includes(n) && !n.includes(phrase) && !(phrase.includes("bird") && n.includes("bird")));
    const out = await this.clf(audio, [phrase, ...rivals], { hypothesis_template: CONFIG.model.template });
    return (out as { label: string; score: number }[]).find((o) => o.label === phrase)?.score ?? 0;
  }
}

// Dev fallback (?mock=1): loudness as a stand-in score, to exercise the UI without a model.
export class MockMatcher implements AudioMatcher {
  async load() {}
  async match(audio: Float32Array) {
    let s = 0;
    for (const x of audio) s += x * x;
    return Math.min(1, Math.sqrt(s / audio.length) * 12);
  }
}

export const createMatcher = (): AudioMatcher =>
  new URLSearchParams(location.search).has("mock") ? new MockMatcher() : new ClapMatcher();
