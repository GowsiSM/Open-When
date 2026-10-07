// Model registry: which local model each condition type needs, and how it is installed.
import { CONFIG } from "./config";
import type { Mode } from "./condition";
import { loadClap, modelInstalled, resetClap, Progress } from "./matcher";

export interface ModelInfo {
  id: string; name: string; tagline: string; mode: Mode | "parse"; hfId: string; sourceUrl: string; license: string;
  estMB: number | null; recommended: boolean; available: boolean; why: string;
}
export const MODELS: ModelInfo[] = [
  { id: "clap", name: "CLAP", tagline: "Environmental audio", mode: "hear", hfId: CONFIG.model.id,
    sourceUrl: "https://huggingface.co/" + CONFIG.model.id, license: "Apache-2.0 (upstream laion/clap-htsat-unfused)", estMB: 45, recommended: true, available: true,
    why: "CLAP matches sounds to written descriptions, which is what turns “open when you hear running water” into a detection task. It runs on your device; audio is never uploaded. License: the upstream LAION model page lists Apache-2.0; the Xenova ONNX conversion Open When downloads has its own page, whose license field I could not read, so check it before redistributing." },
  { id: "vision", name: "Vision model", tagline: "SEE conditions (planned)", mode: "see", hfId: "", sourceUrl: "", license: "tbd", estMB: null, recommended: false, available: false,
    why: "For “open when you see a sunset”. Not shipped: no phone-reliable model chosen yet." },
  { id: "ocr", name: "Text / OCR model", tagline: "FIND conditions (planned)", mode: "find", hfId: "", sourceUrl: "", license: "tbd", estMB: null, recommended: false, available: false,
    why: "For “open when you find a sign saying RIVER”. Not shipped." },
  { id: "gemma", name: "Gemma", tagline: "Condition parsing (planned)", mode: "parse", hfId: "", sourceUrl: "https://ai.google.dev/gemma", license: "Gemma terms", estMB: null, recommended: false, available: false,
    why: "Would turn “it's raining really hard” into a structured condition (target “heavy rain”, rivals “light rain”, “wind”). CLAP would still do the listening." },
];
/** Which model does a condition mode need? */
export const modelFor = (mode: Mode) => MODELS.find((m) => m.mode === mode && m.available) ?? null;

export type ErrKind = "offline" | "storage" | "unsupported" | "failed";
export class ModelError extends Error { constructor(public kind: ErrKind, msg: string) { super(msg); } }
export const classify = (e: any, online: boolean): ModelError => {
  if (e instanceof ModelError) return e;
  if (e?.name === "QuotaExceededError" || /quota|storage/i.test(e?.message ?? "")) return new ModelError("storage", "Not enough storage on this device.");
  if (!online || /network|fetch|Failed to load/i.test(e?.message ?? "")) return new ModelError("offline", "The download was interrupted.");
  return new ModelError("failed", e?.message ?? "Install failed.");
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

const KEY = "ow:model-bytes";
export const installedBytes = () => { try { return Number(localStorage.getItem(KEY)) || null; } catch { return null; } };

export async function installModel(onP: (p: Progress) => void): Promise<void> {
  if (!supported()) throw new ModelError("unsupported", "This browser can't store local models (needs HTTPS, WebAssembly and the Cache API).");
  if (!navigator.onLine && !(await modelInstalled())) throw new ModelError("offline", "You're offline and the local AI model isn't installed yet. Connect once to install it.");
  try {
    navigator.storage?.persist?.(); // ask the browser not to evict the model
    let last = 0;
    await loadClap((p) => { last = p.total; onP(p); });
    if (last) try { localStorage.setItem(KEY, String(last)); } catch {}
  } catch (e) { throw classify(e, navigator.onLine); }
}

export async function removeModel() {
  resetClap();
  try { const c = await caches.open("transformers-cache"); for (const k of await c.keys()) if (k.url.includes(CONFIG.model.id)) await c.delete(k); localStorage.removeItem(KEY); } catch {}
}
