import { CONFIG } from "./config";
import { conditionPhrase } from "./card";

export interface LabelScore { label: string; score: number }
export interface MatchResult { score: number; scores: LabelScore[]; ms: number }

// The rest of the app only knows this interface. Swap the model by swapping the class.
export interface AudioMatcher {
  load(onProgress?: (pct: number) => void): Promise<void>;
  /** audio: mono Float32 at CONFIG.model.sampleRate. score is 0..1; scores is the full breakdown. */
  match(audio: Float32Array, condition: string): Promise<MatchResult>;
}

// Local open-weight CLAP via Transformers.js. Audio never leaves the device.
export class ClapMatcher implements AudioMatcher {
  private clf: any;
  async load(onProgress?: (pct: number) => void) {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    // ONNX wasm is served from our own origin (copied to public/ort) so inference works offline.
    (env.backends.onnx as any).wasm.wasmPaths = import.meta.env.BASE_URL + "ort/";
    this.clf = await (pipeline as any)("zero-shot-audio-classification", CONFIG.model.id, {
      dtype: CONFIG.model.dtype,
      progress_callback: (p: any) => p?.progress != null && onProgress?.(Math.round(p.progress)),
    });
  }
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    const t0 = performance.now();
    const phrase = conditionPhrase(condition);
    const rivals = CONFIG.negatives.filter((n) => !phrase.includes(n) && !n.includes(phrase) && !(phrase.includes("bird") && n.includes("bird")));
    const out = (await this.clf(audio, [phrase, ...rivals], { hypothesis_template: CONFIG.model.template })) as LabelScore[];
    const scores = [...out].sort((a, b) => b.score - a.score);
    return { score: out.find((o) => o.label === phrase)?.score ?? 0, scores, ms: Math.round(performance.now() - t0) };
  }
}

// Dev fallback (?mock=1): loudness as a stand-in score, to exercise the UI without a model.
export class MockMatcher implements AudioMatcher {
  async load() {}
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    let s = 0;
    for (const x of audio) s += x * x;
    const score = Math.min(1, Math.sqrt(s / audio.length) * 12);
    return { score, scores: [{ label: conditionPhrase(condition), score }], ms: 0 };
  }
}

export const createMatcher = (): AudioMatcher =>
  new URLSearchParams(location.search).has("mock") ? new MockMatcher() : new ClapMatcher();

/** Is the model already in the browser cache (i.e. usable with no network)? */
export async function modelInstalled(): Promise<boolean> {
  try {
    if (new URLSearchParams(location.search).has("mock")) return true;
    const keys = await (await caches.open("transformers-cache")).keys();
    return keys.some((k) => k.url.includes(CONFIG.model.id) && k.url.includes(".onnx"));
  } catch { return false; }
}
