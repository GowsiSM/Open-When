import { describe, expect, it } from "vitest";
import { cardUrl, conditionPhrase, decodeCard, encodeCard, isLocalBase, makeCard } from "../src/card";
import { Detector } from "../src/detector";
import { CONFIG } from "../src/config";
import { resample } from "../src/audio";
import { INITIAL, recover, reduce, Ctx, Ev } from "../src/machine";
import { isSatisfied, parseCondition } from "../src/condition";
import { MockMatcher } from "../src/matcher";

const card = makeCard({ condition: "you hear running water", message: "hi" });
const run = (evs: Ev[], from: Ctx = INITIAL) => evs.reduce(reduce, from);

describe("cards", () => {
  it("round-trips unicode", () => { const c = makeCard({ condition: "birds", message: "You made it ❤️", from: "Ana" }); expect(decodeCard(encodeCard(c))).toEqual(c); });
  it("rejects bad payloads and empty fields", () => { expect(decodeCard("garbage")).toBeNull(); expect(() => makeCard({ condition: "", message: "x" })).toThrow(); });
  it("extracts the sound phrase", () => { expect(conditionPhrase("Open when you hear running water.")).toBe("running water"); });
  it("builds links on the public base and flags local ones", () => {
    expect(cardUrl(card, "https://x.app/?a#old").startsWith("https://x.app/#c=")).toBe(true);
    expect(isLocalBase("http://192.168.1.2:5173/")).toBe(true); expect(isLocalBase("https://x.app/")).toBe(false);
  });
});

describe("conditions", () => {
  it("accepts a hear condition", () => { const r = parseCondition("Open when you hear running water."); expect(r.ok && r.cond.atoms[0]).toEqual({ mode: "hear", phrase: "running water" }); });
  it("rejects empty, unsupported and multiple", () => {
    expect(parseCondition("").ok).toBe(false); expect(parseCondition("you see a bridge").ok).toBe(false); expect(parseCondition("hear birds and hear rain").ok).toBe(false);
  });
  it("models ordered conditions for later", () => {
    const c = { op: "THEN" as const, atoms: [{ mode: "hear" as const, phrase: "a" }, { mode: "see" as const, phrase: "b" }] };
    expect(isSatisfied(c, [false, true])).toBe(false); expect(isSatisfied(c, [true, true])).toBe(true);
  });
});

describe("detector", () => {
  const feed = (xs: number[]) => { const d = new Detector(); return xs.map((x, i) => d.push(x, i * 2000).level); };
  it("does not unlock from a single spike", () => expect(feed([0.1, 0.1, 0.1, 0.99]).includes("confirmed")).toBe(false));
  it("needs sustained high scores for the minimum duration", () => {
    const l = feed([0.3, 0.8, 0.9, 0.9, 0.9, 0.9]);
    expect(l[3]).not.toBe("confirmed"); expect(l[5]).toBe("confirmed");
  });
  it("a dip resets the streak and starts a cooldown", () => { expect(feed([0.9, 0.9, 0.9, 0.0, 0.0, 0.9, 0.9]).includes("confirmed")).toBe(false); });
  it("ramps through levels", () => { const d = new Detector(); expect(d.push(0.05, 0).level).toBe("none"); d.push(0.6, 2000); expect(d.push(0.6, 4000).level).toBe("medium"); });
  it("reset clears state", () => { const d = new Detector(); [0.9, 0.9, 0.9].forEach((x, i) => d.push(x, i * 2000)); d.reset(); expect(d.push(0.1, 9000).level).toBe("none"); });
});

describe("state machine", () => {
  const sealed = run([{ t: "CREATE" }, { t: "SEALED", card }, { t: "ACK" }]);
  it("walks the full happy path", () => {
    let c = run([{ t: "BEGIN", now: 0 }, { t: "FIELD" }, { t: "SIGNAL", level: "medium" }, { t: "SIGNAL", level: "none" }, { t: "SIGNAL", level: "high" }, { t: "CONFIRMED", now: 60000 }, { t: "ACK" }, { t: "OPEN" }, { t: "FINISH" }], sealed);
    expect(c.phase).toBe("summary"); expect(c.listenMs).toBe(60000); expect(c.foundAt).toBe(60000);
  });
  it("ignores invalid transitions", () => {
    expect(reduce(INITIAL, { t: "OPEN" })).toBe(INITIAL); expect(reduce(INITIAL, { t: "BEGIN", now: 1 })).toBe(INITIAL);
    expect(reduce(sealed, { t: "CONFIRMED", now: 1 }).phase).toBe("ready"); expect(run([{ t: "BEGIN", now: 0 }, { t: "HOME" }], sealed).phase).toBe("listening");
  });
  it("cannot reach the message without confirmation", () => expect(run([{ t: "BEGIN", now: 0 }, { t: "OPEN" }, { t: "FINISH" }], sealed).phase).toBe("listening"));
  it("STOP banks listening time and keeps the session clock", () => { const c = run([{ t: "BEGIN", now: 100 }, { t: "STOP", now: 5100 }], sealed); expect(c.listenMs).toBe(5000); expect(c.startedAt).toBe(100); });
  it("recovers a live session as ready, and a confirmed one as unlock", () => {
    const live = run([{ t: "BEGIN", now: 0 }, { t: "SIGNAL", level: "high" }], sealed);
    expect(recover(JSON.parse(JSON.stringify(live))).phase).toBe("ready");
    expect(recover({ ...live, phase: "confirmed" }).phase).toBe("unlock"); expect(recover(null)).toEqual(INITIAL);
  });
});

describe("audio + matcher", () => {
  it("resamples to the right length", () => expect(resample(new Float32Array(44100), 44100, 48000).length).toBe(48000));
  it("mock matcher is deterministic and returns a breakdown", async () => {
    const m = new MockMatcher(); const loud = new Float32Array(1000).fill(0.5), quiet = new Float32Array(1000);
    expect((await m.match(loud, "birds")).score).toBe(1); expect((await m.match(quiet, "birds")).score).toBe(0);
    expect((await m.match(loud, "birds")).scores[0].label).toBe("birds");
  });
});

import { MODELS, ModelError, classify, modelFor } from "../src/models";
describe("model registry", () => {
  it("maps hear to CLAP and keeps unshipped modes unavailable", () => {
    expect(modelFor("hear")?.id).toBe("clap"); expect(modelFor("see")).toBeNull(); expect(modelFor("find")).toBeNull();
    expect(MODELS.filter((m) => m.recommended)).toHaveLength(1);
  });
  it("classifies install failures", () => {
    expect(classify({ name: "QuotaExceededError" }, true).kind).toBe("storage");
    expect(classify(new Error("Failed to fetch"), false).kind).toBe("offline");
    expect(classify(new Error("boom"), true).kind).toBe("failed");
    expect(classify(new ModelError("unsupported", "x"), true).kind).toBe("unsupported");
  });
});

import { CONDITIONS, aggregate, resolveCondition } from "../src/conditionConfig";
import { LETTER_THEMES, themeOf } from "../src/card";
import { IMPROVEMENT, modelState } from "../src/models";
describe("letter themes", () => {
  it("round-trips the chosen theme and falls back to field", () => {
    LETTER_THEMES.forEach((t) => expect(decodeCard(encodeCard(makeCard({ condition: "birds", message: "x", theme: t.id })))?.th).toBe(t.id));
    expect(makeCard({ condition: "birds", message: "x", theme: "neon" }).th).toBe("field");
    expect(themeOf(null)).toBe("field");
  });
});
describe("condition config", () => {
  it("resolves natural phrases to calibrated conditions and falls back to generic", () => {
    expect(resolveCondition("running water").id).toBe("running-water");
    expect(resolveCondition("a stream").id).toBe("running-water");
    expect(resolveCondition("heavy rain").id).toBe("rain");
    const g = resolveCondition("a church bell"); expect(g.id).toBe("generic"); expect(g.prompts).toContain("a church bell");
  });
  it("every condition has several prompts, rivals, and no prompt/rival overlap", () => {
    CONDITIONS.forEach((c) => { expect(c.prompts.length).toBeGreaterThan(1); expect(c.rivals.length).toBeGreaterThan(2); expect(c.rivals.filter((r) => c.prompts.includes(r))).toEqual([]); });
  });
  it("lets one condition override detector params", () => {
    const d = new Detector({ ...CONFIG.detection, minConfirmMs: 0, hitsRequired: 1 }); expect(d.push(0.95, 0).level).toBe("confirmed");
  });
});
describe("prompt aggregation", () => {
  const cfg = resolveCondition("running water"), p = cfg.prompts;
  it("sums the positive prompts and keeps a clear margin", () => {
    const a = aggregate([{ label: p[0], score: 0.3 }, { label: p[1], score: 0.3 }, { label: "rain", score: 0.2 }], cfg);
    expect(a.raw).toBeCloseTo(0.6); expect(a.score).toBeCloseTo(0.6); expect(a.margin).toBeCloseTo(0.4);
  });
  it("penalises a thin margin so a rival cannot sneak a win", () => {
    const a = aggregate([{ label: p[0], score: 0.2 }, { label: "rain", score: 0.5 }], cfg);
    expect(a.score).toBeCloseTo(0.1);
  });
  it("max mode and clamping", () => {
    expect(aggregate([{ label: p[0], score: 0.9 }, { label: p[1], score: 0.9 }], cfg).raw).toBe(1);
    expect(aggregate([{ label: p[0], score: 0.4 }, { label: p[1], score: 0.3 }], { ...cfg, aggregate: "max" }).raw).toBe(0.4);
  });
});
describe("offline model states", () => {
  it("names all four states plus checking", () => {
    expect(modelState(false, true)).toBe("Online · model not installed"); expect(modelState(true, true)).toBe("Online · model ready");
    expect(modelState(true, false)).toBe("Offline · model ready"); expect(modelState(false, false)).toBe("Offline · model not installed");
    expect(modelState(null, true)).toContain("checking");
  });
  it("labels unmeasured improvements as such", () => { expect(IMPROVEMENT.filter((i) => i.status === "planned").length).toBeGreaterThan(1); });
});

import { readFileSync } from "node:fs";
import { THEME_COLOR, nextTheme, resolveMode, themeLabel } from "../src/theme";
import { RunLog, csvCell } from "../src/log";

describe("theme toggle", () => {
  it("resolves the preference to a concrete mode", () => {
    expect(resolveMode("light", true)).toBe("light"); expect(resolveMode("dark", false)).toBe("dark");
    expect(resolveMode("system", true)).toBe("dark"); expect(resolveMode("system", false)).toBe("light");
  });
  it("cycles Auto -> Light -> Dark -> Auto and labels each", () => {
    expect(nextTheme("system")).toBe("light"); expect(nextTheme("light")).toBe("dark"); expect(nextTheme("dark")).toBe("system");
    expect(["system", "light", "dark"].map((t) => themeLabel(t as any))).toEqual(["Auto", "Light", "Dark"]);
    expect(THEME_COLOR.dark).not.toBe(THEME_COLOR.light);
  });
  // Regression guard for the original bug: letter styles only had light palettes, so they overrode the toggle.
  const css = readFileSync("src/styles.css", "utf8");
  it("every letter style defines both a light and a dark palette", () => {
    for (const t of LETTER_THEMES.map((x) => x.id)) {
      expect(css).toContain(`:root[data-mode="light"][data-letter="${t}"]`);
      expect(css).toContain(`:root[data-mode="dark"][data-letter="${t}"]`);
    }
  });
  it("no palette depends on the OS setting or the raw data-theme attribute", () => {
    expect(css).not.toContain("prefers-color-scheme"); expect(css).not.toMatch(/:root\[data-theme/);
  });
  it("field mode override comes after the letter palettes", () => {
    expect(css.indexOf(":root[data-field][data-mode]")).toBeGreaterThan(css.lastIndexOf('[data-letter="dove"]'));
  });
});

describe("run log (field calibration)", () => {
  const row = (o: Partial<Parameters<RunLog["add"]>[0]> = {}) => ({ t: 0, rms: 0.01, raw: 0.5, score: 0.5, margin: 0.2, smoothed: 0.4, hits: 1, level: "low", ms: 120, top: "a stream flowing", ...o });
  it("writes a header and one escaped row per window", () => {
    const l = new RunLog(); l.add(row({ top: 'rain, "heavy"' }));
    const [h, r] = l.toCsv({ condition: "running water", place: "bridge, north side" }).split("\n");
    expect(h.startsWith("time_iso,condition,place")).toBe(true); expect(r).toContain('"bridge, north side"'); expect(r).toContain('"rain, ""heavy"""');
  });
  it("is bounded and averages columns", () => {
    const l = new RunLog(3); [0.2, 0.4, 0.6, 0.8].forEach((m) => l.add(row({ margin: m })));
    expect(l.rows).toHaveLength(3); expect(l.mean("margin")).toBeCloseTo(0.6); expect(new RunLog().mean("raw")).toBe(0);
  });
  it("escapes only when needed", () => { expect(csvCell("plain")).toBe("plain"); expect(csvCell("a\nb")).toBe('"a\nb"'); });
});
