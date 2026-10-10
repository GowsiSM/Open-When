// Model registry: which local model the supported condition type needs, and how it is installed.
import { CONFIG } from "./config";
import type { Mode } from "./condition";
import { loadClap, modelInstalled, modelPartsInstalled, resetClap, Progress } from "./matcher";

export interface ModelInfo {
  id: string; name: string; tagline: string; mode: Mode | "parse"; hfId: string; sourceUrl: string; license: string;
  estMB: number | null; recommended: boolean; available: boolean; why: string;
}
export const MODELS: ModelInfo[] = [
  { id: "clap", name: "CLAP", tagline: "Environmental audio", mode: "hear", hfId: CONFIG.model.id,
    sourceUrl: "https://huggingface.co/" + CONFIG.model.id, license: "Apache-2.0 base model; conversion license unspecified", estMB: 34.3, recommended: true, available: true,
    why: "CLAP matches sounds to written descriptions, which is what turns “open when you hear running water” into a detection task. It runs on your device; audio is never uploaded. The app uses Xenova's 34.3 MB quantized audio-only ONNX file. LAION's base model declares Apache-2.0; the Xenova conversion does not state a separate license." },
];
/** Which model does a condition mode need? */
export const modelFor = (mode: Mode) => MODELS.find((m) => m.mode === mode && m.available) ?? null;

export type ErrKind = "offline" | "storage" | "unsupported" | "failed";
export class ModelError extends Error { constructor(public kind: ErrKind, msg: string) { super(msg); } }
export const classify = (e: unknown, online: boolean): ModelError => {
  if (e instanceof ModelError) return e;
  const message = e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : typeof e === "object" && e !== null && "message" in e && typeof e.message === "string"
        ? e.message
        : "";
  const name = typeof e === "object" && e !== null && "name" in e && typeof e.name === "string" ? e.name : "";
  if (name === "QuotaExceededError" || /quota|storage/i.test(message)) return new ModelError("storage", message || "Not enough storage on this device.");
  if (!online || /network|fetch|Failed to load/i.test(message)) return new ModelError("offline", message || "The download was interrupted.");
  return new ModelError("failed", message || "Model installation failed for an unknown reason.");
};
export const supported = () => typeof caches !== "undefined" && typeof WebAssembly !== "undefined" && window.isSecureContext;

export const modelState = (installed: boolean | null, online: boolean) =>
  `${online ? "Online" : "Offline"} · ${installed === null ? "checking model" : installed ? "model ready" : "model not installed"}`;
export const IMPROVEMENT = [
  { name: "Prompt ensemble", status: "in app", note: "Several phrasings per sound, summed. Gain not measured yet." },
  { name: "Condition calibration", status: "in app", note: "Per-sound margin and detector overrides. Values are uncalibrated defaults." },
  { name: "Hard-negative dataset", status: "planned", note: "Real recordings of confusing sounds." },
  { name: "Lightweight classifier on CLAP embeddings", status: "planned", note: "Small head, may be the best next step." },
  { name: "Fine-tuned model", status: "planned", note: "Only if the above fall short. See MODEL_FINE_TUNING.md." },
];
export const PRIVACY = [
  "Microphone audio stays on this device. It is analysed in short windows in memory and discarded.",
  "No raw recordings are uploaded or stored. Inference runs locally.",
  "Letters stay on this device unless you share the link. A link contains the message, so share it with care.",
  "The internet is only used to install the model once. No analytics or error reporting is included.",
];

export async function installModel(onP: (p: Progress) => void): Promise<void> {
  if (!supported()) throw new ModelError("unsupported", "This browser can't store local models (needs HTTPS, WebAssembly and the Cache API).");
  if (!navigator.onLine && !(await modelInstalled())) throw new ModelError("offline", "You're offline and the local AI model isn't installed yet. Connect once to install it.");
  try {
    navigator.storage?.persist?.(); // ask the browser not to evict the model
    await loadClap(onP);
  } catch (e) { throw classify(e, navigator.onLine); }
}

export async function removeModel() {
  resetClap();
  try {
    const c = await caches.open("transformers-cache");
    for (const k of await c.keys()) if (k.url.includes(CONFIG.model.id)) await c.delete(k);
    const parts = await caches.open("open-when-model-parts");
    for (const k of await parts.keys()) await parts.delete(k);
  } catch {}
}
