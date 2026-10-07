import { describe, expect, it } from "vitest";
import { cardUrl, conditionPhrase, decodeCard, encodeCard, isLocalBase, makeCard } from "../src/card";
import { Detector } from "../src/detector";
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
