import { CONFIG } from "./config";
import { conditionPhrase } from "./card";
import { resolveCondition } from "./conditionConfig";
import type {
  ClapAudioModelWithProjection,
  Processor,
} from "@huggingface/transformers";

export interface LabelScore {
  label: string;
  score: number;
}
export interface MatchResult {
  score: number;
  raw: number;
  margin: number;
  cfgId: string;
  scores: LabelScore[];
  ms: number;
}

// The rest of the app only knows this interface. Swap the model by swapping the class.
export interface AudioMatcher {
  load(onProgress?: (pct: number) => void): Promise<void>;
  /** audio: mono Float32 at CONFIG.model.sampleRate. score is 0..1; scores is the full breakdown. */
  match(audio: Float32Array, condition: string): Promise<MatchResult>;
}

export interface Progress {
  loaded: number;
  total: number;
  pct: number;
}
interface LinearHead {
  embedding_dim: number;
  classes: string[];
  weights: number[][];
  biases: number[];
}
interface ClapAssets {
  processor: Processor;
  audioModel: ClapAudioModelWithProjection;
  head: LinearHead;
}

let clapP: Promise<ClapAssets> | null = null;
const subs = new Set<(p: Progress) => void>();
export const resetClap = () => {
  clapP = null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

function parseLinearHead(value: unknown): LinearHead {
  if (
    !isRecord(value) ||
    value.embedding_dim !== 512 ||
    !Array.isArray(value.classes) ||
    !Array.isArray(value.weights) ||
    !Array.isArray(value.biases)
  ) {
    throw new Error("The bundled linear classifier has an invalid format.");
  }

  const classes: string[] = [];
  for (const label of value.classes) {
    if (typeof label !== "string" || !label.trim())
      throw new Error(
        "The bundled linear classifier has an invalid class label.",
      );
    classes.push(label);
  }
  if (classes.length < 2 || new Set(classes).size !== classes.length) {
    throw new Error(
      "The bundled linear classifier must contain unique classes.",
    );
  }

  const weights: number[][] = [];
  for (const row of value.weights) {
    if (!isFiniteNumberArray(row) || row.length !== value.embedding_dim) {
      throw new Error("The bundled linear classifier has invalid weights.");
    }
    weights.push(row);
  }
  if (
    weights.length !== classes.length ||
    value.biases.length !== classes.length ||
    !isFiniteNumberArray(value.biases)
  ) {
    throw new Error(
      "The bundled linear classifier dimensions do not match its classes.",
    );
  }

  return {
    embedding_dim: value.embedding_dim,
    classes,
    weights,
    biases: value.biases,
  };
}

async function loadLinearHead(): Promise<LinearHead> {
  const response = await fetch(`${import.meta.env.BASE_URL}linear_head.json`);
  if (!response.ok)
    throw new Error(
      `Could not load the bundled linear classifier (${response.status}).`,
    );
  return parseLinearHead(await response.json());
}

// One shared pipeline: installing the model and listening use the same instance.
export function loadClap(onP?: (p: Progress) => void): Promise<ClapAssets> {
  if (onP) subs.add(onP);
  clapP ??= (async () => {
    const { AutoProcessor, ClapAudioModelWithProjection, env } =
      await import("@huggingface/transformers");
    env.allowLocalModels = false;
    (env.backends.onnx as any).wasm.wasmPaths =
      import.meta.env.BASE_URL + "ort/"; // served locally: works offline
    const files: Record<string, [number, number]> = {};
    const progress_callback = (e: any) => {
      if (e?.status !== "progress" || !e.total) return;
      files[e.file] = [e.loaded, e.total];
      const loaded = Object.values(files).reduce((a, f) => a + f[0], 0),
        total = Object.values(files).reduce((a, f) => a + f[1], 0);
      subs.forEach((f) =>
        f({ loaded, total, pct: Math.round((loaded / total) * 100) }),
      );
    };
    const [processor, audioModel, head] = await Promise.all([
      AutoProcessor.from_pretrained(CONFIG.model.id, { progress_callback }),
      ClapAudioModelWithProjection.from_pretrained(CONFIG.model.id, {
        dtype: CONFIG.model.dtype,
        progress_callback,
      }),
      loadLinearHead(),
    ]);
    return { processor, audioModel, head };
  })()
    .catch((e) => {
      clapP = null;
      throw e;
    })
    .finally(() => subs.clear());
  return clapP;
}

// Local open-weight CLAP via Transformers.js. Audio never leaves the device.
export class ClapMatcher implements AudioMatcher {
  private clap: ClapAssets | null = null;
  async load(onProgress?: (pct: number) => void) {
    this.clap = await loadClap(onProgress && ((p) => onProgress(p.pct)));
  }
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    const t0 = performance.now();
    const cfg = resolveCondition(conditionPhrase(condition));
    if (!this.clap)
      throw new Error("The CLAP audio model has not been loaded.");
    const targetClass = cfg.id.replace(/-/g, " ");
    const targetIndex = this.clap.head.classes.indexOf(targetClass);
    if (targetIndex < 0) {
      throw new Error(
        `The linear classifier does not support "${cfg.id}". Supported sounds: ${this.clap.head.classes.join(", ")}.`,
      );
    }

    const inputs = await this.clap.processor(audio);
    const output: unknown = await this.clap.audioModel(inputs);
    if (
      !isRecord(output) ||
      !isRecord(output.audio_embeds) ||
      (!(output.audio_embeds.data instanceof Float32Array) &&
        !(output.audio_embeds.data instanceof Float64Array))
    ) {
      throw new Error("CLAP did not return a valid audio embedding.");
    }
    const audioEmbedding = output.audio_embeds.data;
    const head = this.clap.head;
    if (audioEmbedding.length !== head.embedding_dim)
      throw new Error(
        `Expected a ${head.embedding_dim}-dimensional CLAP audio embedding.`,
      );
    let normSquared = 0;
    for (const value of audioEmbedding) normSquared += value * value;
    const norm = Math.sqrt(normSquared);
    if (!Number.isFinite(norm) || norm === 0)
      throw new Error("CLAP returned an empty audio embedding.");

    const logits = head.weights.map((row, i) => {
      let logit = head.biases[i];
      for (let j = 0; j < row.length; j++)
        logit += (row[j] * audioEmbedding[j]) / norm;
      return logit;
    });
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map((logit) => Math.exp(logit - maxLogit));
    const probabilityTotal = expLogits.reduce((sum, value) => sum + value, 0);
    const probabilities = expLogits.map((value) => value / probabilityTotal);
    const predictedIndex = logits.indexOf(maxLogit);
    const pred = {
      label: head.classes[predictedIndex],
      score: probabilities[predictedIndex],
    };
    const scores = [
      pred,
      ...head.classes
        .map((label, i) => ({ label, score: probabilities[i] }))
        .filter((_, i) => i !== predictedIndex)
        .sort((a, b) => b.score - a.score),
    ];
    const raw = probabilities[targetIndex];
    const bestRival = Math.max(
      ...probabilities.filter((_, i) => i !== targetIndex),
    );
    const margin = raw - bestRival;
    const score = margin >= cfg.minMargin ? raw : raw * 0.5;
    return {
      score,
      raw,
      margin,
      cfgId: cfg.id,
      scores,
      ms: Math.round(performance.now() - t0),
    };
  }
}

// Dev fallback (?mock=1): loudness as a stand-in score, to exercise the UI without a model.
export class MockMatcher implements AudioMatcher {
  async load() {}
  async match(audio: Float32Array, condition: string): Promise<MatchResult> {
    let s = 0;
    for (const x of audio) s += x * x;
    const score = Math.min(1, Math.sqrt(s / audio.length) * 12);
    return {
      score,
      raw: score,
      margin: 0,
      cfgId: "mock",
      scores: [{ label: conditionPhrase(condition), score }],
      ms: 0,
    };
  }
}

export const createMatcher = (): AudioMatcher =>
  new URLSearchParams(location.search).has("mock")
    ? new MockMatcher()
    : new ClapMatcher();

/** Is the model already in the browser cache (i.e. usable with no network)? */
export async function modelInstalled(): Promise<boolean> {
  try {
    if (new URLSearchParams(location.search).has("mock")) return true;
    const keys = await (await caches.open("transformers-cache")).keys();
    return keys.some(
      (k) => k.url.includes(CONFIG.model.id) && k.url.includes(".onnx"),
    );
  } catch {
    return false;
  }
}
