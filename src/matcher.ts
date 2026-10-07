import { CONFIG } from "./config";
import { conditionPhrase } from "./card";
import { aggregate, resolveCondition } from "./conditionConfig";

export interface LabelScore { label: string; score: number }
export interface MatchResult { score: number; raw: number; margin: number; cfgId: string; scores: LabelScore[]; ms: number }

// The rest of the app only knows this interface. Swap the model by swapping the class.
export interface AudioMatcher {
  load(onProgress?: (pct: number) => void): Promise<void>;
  /** audio: mono Float32 at CONFIG.model.sampleRate. score is 0..1; scores is the full breakdown. */
  match(audio: Float32Array, condition: string): Promise<MatchResult>;
}

export interface Progress { loaded: number; total: number; pct: number }
let clapP: Promise<any> | null = null;
const subs = new Set<(p: Progress) => void>();
export const resetClap = () => { clapP = null; };

// One shared pipeline: installing the model and listening use the same instance.
export function loadClap(onP?: (p: Progress) => void): Promise<any> {
  if (onP) subs.add(onP);
  clapP ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    (env.backends.onnx as any).wasm.wasmPaths = import.meta.env.BASE_URL + "ort/"; // served locally: works offline
    const files: Record<string, [number, number]> = {};
    return (pipeline as any)("zero-shot-audio-classification", CONFIG.model.id, {
      dtype: CONFIG.model.dtype,
      progress_callback: (e: any) => {
        if (e?.status !== "progress" || !e.total) return;
        files[e.file] = [e.loaded, e.total];
        const loaded = Object.values(files).reduce((a, f) => a + f[0], 0), total = Object.values(files).reduce((a, f) => a + f[1], 0);
        subs.forEach((f) => f({ loaded, total, pct: Math.round((loaded / total) * 100) }));
      },
    });
  })().catch((e) => { clapP = null; throw e; }).finally(() => subs.clear());
  return clapP;
}

// Local open-weight CLAP via Transformers.js. Audio never leaves the device.
export class ClapMatcher implements AudioMatcher {
  private clf: any;
  async load(onProgress?: (pct: number) => void) { this.clf = await loadClap(onProgress && ((p) => onProgress(p.pct))); }
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    const t0 = performance.now();
    const cfg = resolveCondition(conditionPhrase(condition));
    const labels = [...cfg.prompts, ...cfg.rivals.filter((r) => !cfg.prompts.includes(r))];
    const out = (await this.clf(audio, labels, { hypothesis_template: CONFIG.model.template })) as LabelScore[];
    const a = aggregate(out, cfg);
    return { score: a.score, raw: a.raw, margin: a.margin, cfgId: cfg.id, scores: [...out].sort((x, y) => y.score - x.score), ms: Math.round(performance.now() - t0) };
  }
}

// Dev fallback (?mock=1): loudness as a stand-in score, to exercise the UI without a model.
export class MockMatcher implements AudioMatcher {
  async load() {}
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    let s = 0;
    for (const x of audio) s += x * x;
    const score = Math.min(1, Math.sqrt(s / audio.length) * 12);
    return { score, raw: score, margin: 0, cfgId: "mock", scores: [{ label: conditionPhrase(condition), score }], ms: 0 };
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
