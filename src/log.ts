// Field-test log: one row per scored window, exportable as CSV so real readings can fill the
// calibration table (and later become labelled data for a classifier). Stays in memory, never uploaded.
export interface LogRow { t: number; rms: number; raw: number; score: number; margin: number; smoothed: number; hits: number; level: string; ms: number; top: string }
export interface LogMeta { condition: string; place?: string; device?: string }

const COLS = ["time_iso", "condition", "place", "rms", "raw", "score", "margin", "smoothed", "hits", "level", "ms", "top_label"] as const;
export const csvCell = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export class RunLog {
  rows: LogRow[] = [];
  constructor(private max = 600) {}
  add(r: LogRow) { this.rows.push(r); if (this.rows.length > this.max) this.rows.shift(); }
  clear() { this.rows = []; }
  toCsv(meta: LogMeta): string {
    const f = (n: number, d = 3) => n.toFixed(d);
    const lines = this.rows.map((r) => [new Date(r.t).toISOString(), meta.condition, meta.place ?? "", f(r.rms, 4), f(r.raw), f(r.score), f(r.margin), f(r.smoothed), r.hits, r.level, r.ms, r.top].map(csvCell).join(","));
    return [COLS.join(","), ...lines].join("\n");
  }
  /** Mean of a column: handy for the calibration table (e.g. average margin near a stream). */
  mean(k: "raw" | "score" | "margin" | "smoothed" | "rms") { return this.rows.length ? this.rows.reduce((a, r) => a + r[k], 0) / this.rows.length : 0; }
}
