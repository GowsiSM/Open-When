import { CONFIG } from "./config";

export type Level = "none" | "low" | "medium" | "high" | "confirmed";
export interface Reading { raw: number; smoothed: number; level: Level }
type Params = typeof CONFIG.detection;

// Never unlocks from one noisy frame: EMA smoothing + N-of-M agreement.
export class Detector {
  private ema: number | null = null;
  private recent: number[] = [];
  constructor(private p: Params = CONFIG.detection) {}

  push(raw: number): Reading {
    this.ema = this.ema === null ? raw : this.p.emaAlpha * raw + (1 - this.p.emaAlpha) * this.ema;
    this.recent.push(raw);
    if (this.recent.length > this.p.hitsWindow) this.recent.shift();
    const smoothed = this.ema;
    const hits = this.recent.filter((r) => r >= this.p.high).length;
    let level: Level = "none";
    if (smoothed >= this.p.confirm && hits >= this.p.hitsRequired) level = "confirmed";
    else if (smoothed >= this.p.high) level = "high";
    else if (smoothed >= this.p.medium) level = "medium";
    else if (smoothed >= this.p.low) level = "low";
    return { raw, smoothed, level };
  }

  reset() { this.ema = null; this.recent = []; }
}
