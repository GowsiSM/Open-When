// Per-condition calibration: prompts (positive ensemble), rivals, aggregation, margin, detector overrides.
import { CONFIG } from "./config";
import type { LabelScore } from "./matcher";

export interface CondConfig {
  id: string; keywords: string[]; prompts: string[]; rivals: string[];
  aggregate: "sum" | "max"; minMargin: number; detection?: Partial<typeof CONFIG.detection>;
}
const C = (id: string, keywords: string[], prompts: string[], rivals: string[], over: Partial<CondConfig> = {}): CondConfig =>
  ({ id, keywords, prompts, rivals, aggregate: "sum", minMargin: 0.15, ...over });

// Prompts are unmeasured starting points: see MODEL_FINE_TUNING.md before trusting any of them.
export const CONDITIONS: CondConfig[] = [
  C("running-water", ["water", "stream", "river", "fountain", "tap", "waterfall", "creek", "brook"],
    ["running water", "flowing water", "a stream flowing", "water flowing over rocks", "a river", "a small waterfall", "a fountain", "water running from a tap"],
    ["rain", "wind", "traffic", "people talking", "music", "white noise", "birds chirping", "silence"]),
  C("rain", ["rain", "raining", "drizzle", "downpour", "storm"], ["rain falling", "heavy rain", "raindrops on leaves", "a rainstorm"], ["running water", "wind", "traffic", "white noise", "people talking", "silence"]),
  C("birds", ["bird", "birds", "chirp", "birdsong"], ["birds chirping", "birdsong", "a bird singing", "songbirds in the morning"], ["traffic", "wind", "insects", "people talking", "running water", "silence"]),
  C("traffic", ["traffic", "cars", "road", "vehicles"], ["road traffic", "cars driving past", "vehicles on a busy street"], ["wind", "running water", "rain", "music", "people talking", "silence"]),
  C("people-talking", ["talking", "voices", "conversation", "people"], ["people talking", "a conversation", "voices chatting"], ["music", "traffic", "wind", "laughter", "silence"]),
  C("laughter", ["laugh", "laughter", "laughing"], ["laughter", "people laughing", "a child laughing"], ["people talking", "music", "crying", "traffic", "silence"]),
  C("wind", ["wind", "breeze", "gust"], ["wind blowing", "wind in the trees", "a strong breeze"], ["running water", "rain", "traffic", "white noise", "silence"]),
  C("music", ["music", "song", "singing"], ["music playing", "a song", "someone playing an instrument"], ["people talking", "traffic", "birds chirping", "silence"]),
  C("dog-barking", ["dog", "barking", "bark"], ["a dog barking", "dogs barking in the distance"], ["birds chirping", "people talking", "traffic", "silence"]),
  C("footsteps", ["footsteps", "walking", "steps"], ["footsteps", "someone walking on gravel", "shoes on a path"], ["people talking", "traffic", "wind", "silence"]),
];

export function resolveCondition(phrase: string): CondConfig {
  const p = phrase.toLowerCase();
  const words = p.split(/\W+/);
  const hit = CONDITIONS.find((c) => c.keywords.some((k) => words.includes(k)));
  if (hit) return hit;
  return C("generic", [], [p, `the sound of ${p}`], CONFIG.negatives.filter((n) => !p.includes(n) && !n.includes(p)));
}

export interface Aggregated { score: number; raw: number; margin: number; bestRival: number }
/** Sum (or max) the positive prompts, compare with the best rival, and halve the score if the margin is too thin. */
export function aggregate(scores: LabelScore[], cfg: CondConfig): Aggregated {
  const pos = scores.filter((s) => cfg.prompts.includes(s.label)).map((s) => s.score);
  const bestRival = Math.max(0, ...scores.filter((s) => !cfg.prompts.includes(s.label)).map((s) => s.score));
  const raw = cfg.aggregate === "max" ? Math.max(0, ...pos) : Math.min(1, pos.reduce((a, b) => a + b, 0));
  const margin = raw - bestRival;
  return { score: margin >= cfg.minMargin ? raw : raw * 0.5, raw, margin, bestRival };
}
