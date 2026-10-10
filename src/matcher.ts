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
const PARTS_CACHE = "open-when-model-parts";
export const resetClap = () => {
  clapP = null;
};

function modelUrl() {
  const modelPath = CONFIG.model.id;
  return new URL(
    `${import.meta.env.BASE_URL}models/${modelPath}/resolve/${CONFIG.model.revision}/${CONFIG.model.file}`,
    location.origin,
  );
}

function isQuantizedAudioModel(request: RequestInfo | URL) {
  const url = request instanceof Request
    ? new URL(request.url)
    : new URL(String(request), location.href);
  return url.href === modelUrl().href;
}

function reportModelProgress(loaded: number) {
  const total = CONFIG.model.sizeBytes;
  subs.forEach((callback) =>
    callback({ loaded, total, pct: Math.round((loaded / total) * 100) }),
  );
}

const modelFilename = CONFIG.model.file.slice(
  CONFIG.model.file.lastIndexOf("/") + 1,
);

function partUrl(index: number) {
  return new URL(
    `${import.meta.env.BASE_URL}models/chunks/${CONFIG.model.revision}/${modelFilename}.part-${String(index).padStart(3, "0")}`,
    location.origin,
  );
}

async function modelResponse(): Promise<Response> {
  const parts = await caches.open(PARTS_CACHE);
  const chunkCount = Math.ceil(
    CONFIG.model.sizeBytes / CONFIG.model.chunkSizeBytes,
  );
  let index = 0;
  let loaded = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === chunkCount) {
        controller.close();
        return;
      }

      const expected = Math.min(
        CONFIG.model.chunkSizeBytes,
        CONFIG.model.sizeBytes - index * CONFIG.model.chunkSizeBytes,
      );
      const url = partUrl(index);
      const part = await parts.match(url);
      let bytes: Uint8Array;
      if (part) {
        bytes = new Uint8Array(await part.arrayBuffer());
      } else {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Model download failed for chunk ${index + 1}/${chunkCount} (${response.status} ${response.statusText}) at ${url.href}.`,
          );
        }
        if (!response.body) {
          throw new Error(`Model chunk ${index + 1}/${chunkCount} has no response body.`);
        }
        const reader = response.body.getReader();
        const received: Uint8Array[] = [];
        let receivedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received.push(value);
          receivedBytes += value.length;
          reportModelProgress(loaded + receivedBytes);
        }
        bytes = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const block of received) {
          bytes.set(block, offset);
          offset += block.length;
        }
        if (bytes.length !== expected) {
          throw new Error(
            `Model chunk ${index + 1}/${chunkCount} was ${bytes.length} bytes; expected ${expected}.`,
          );
        }
        const storedBytes = new ArrayBuffer(bytes.length);
        new Uint8Array(storedBytes).set(bytes);
        await parts.put(
          url,
          new Response(storedBytes, {
            headers: { "Content-Length": String(bytes.length) },
          }),
        );
      }

      if (bytes.length !== expected) {
        await parts.delete(url);
        throw new Error(
          `Cached model chunk ${index + 1}/${chunkCount} was ${bytes.length} bytes; expected ${expected}.`,
        );
      }
      loaded += bytes.length;
      reportModelProgress(loaded);
      controller.enqueue(bytes);
      index++;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Length": String(CONFIG.model.sizeBytes),
      "Content-Type": "application/octet-stream",
    },
  });
}

const transformerCache = {
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    if (!isQuantizedAudioModel(request)) {
      return (await caches.open("transformers-cache")).match(request);
    }
    const cache = await caches.open("transformers-cache");
    return (await cache.match(request)) ?? modelResponse();
  },
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    await (await caches.open("transformers-cache")).put(request, response);
  },
};

export async function modelPartsInstalled(): Promise<boolean> {
  try {
    const parts = await caches.open(PARTS_CACHE);
    const chunkCount = Math.ceil(
      CONFIG.model.sizeBytes / CONFIG.model.chunkSizeBytes,
    );
    for (let index = 0; index < chunkCount; index++) {
      const url = partUrl(index);
      const part = await parts.match(url);
      if (!part) return false;
      const expected = Math.min(
        CONFIG.model.chunkSizeBytes,
        CONFIG.model.sizeBytes - index * CONFIG.model.chunkSizeBytes,
      );
      if (Number(part.headers.get("Content-Length")) !== expected) {
        await parts.delete(url);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

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
    env.remoteHost = new URL(
      `${import.meta.env.BASE_URL}models/`,
      location.origin,
    ).href;
    env.remotePathTemplate = "{model}/resolve/{revision}/";
    env.useCustomCache = true;
    env.customCache = transformerCache;
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
      AutoProcessor.from_pretrained(CONFIG.model.id, {
        revision: CONFIG.model.revision,
        progress_callback,
      }),
      ClapAudioModelWithProjection.from_pretrained(CONFIG.model.id, {
        dtype: CONFIG.model.dtype,
        revision: CONFIG.model.revision,
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
    if (await modelPartsInstalled()) return true;
    const keys = await (await caches.open("transformers-cache")).keys();
    return keys.some(
      (k) => k.url.includes(CONFIG.model.id) && k.url.includes(CONFIG.model.file),
    );
  } catch {
    return false;
  }
}
