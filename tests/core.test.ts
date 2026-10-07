import { describe, expect, it } from "vitest";
import { cardUrl, conditionPhrase, decodeCard, encodeCard, isLocalBase, makeCard } from "../src/card";
import { Detector } from "../src/detector";
import { resample } from "../src/audio";

describe("cards", () => {
  it("round-trips unicode", () => {
    const c = makeCard({ condition: "you hear birds", message: "You made it ❤️", from: "Ana" });
    expect(decodeCard(encodeCard(c))).toEqual(c);
  });
  it("rejects bad payloads and empty fields", () => {
    expect(decodeCard("garbage")).toBeNull();
    expect(() => makeCard({ condition: "", message: "x" })).toThrow();
  });
  it("extracts the sound phrase", () => {
    expect(conditionPhrase("Open when you hear running water.")).toBe("running water");
    expect(conditionPhrase("birds")).toBe("birds");
  });
});

describe("share links", () => {
  const c = makeCard({ condition: "birds", message: "hi" });
  it("uses the given public base and strips stale hash/query", () => {
    const u = cardUrl(c, "https://open-when.vercel.app/?debug=1#old");
    expect(u.startsWith("https://open-when.vercel.app/#c=")).toBe(true);
    expect(decodeCard(u.split("c=")[1])).toEqual(c);
  });
  it("flags localhost and LAN origins", () => {
    ["http://localhost:5173/", "http://192.168.1.20:5173/", "https://x.local/"].forEach((u) => expect(isLocalBase(u)).toBe(true));
    expect(isLocalBase("https://open-when.vercel.app/")).toBe(false);
  });
});

describe("detector", () => {
  it("does not unlock from a single spike", () => {
    const d = new Detector();
    [0.1, 0.1, 0.1].forEach((s) => d.push(s));
    expect(d.push(0.99).level).not.toBe("confirmed");
  });
  it("unlocks on sustained high scores", () => {
    const d = new Detector();
    let last = "none";
    [0.3, 0.8, 0.9, 0.9, 0.9, 0.9].forEach((s) => (last = d.push(s).level));
    expect(last).toBe("confirmed");
  });
  it("ramps through levels", () => {
    const d = new Detector();
    expect(d.push(0.05).level).toBe("none");
    d.push(0.6);
    expect(d.push(0.6).level).toBe("medium");
  });
});

describe("audio", () => {
  it("resamples to the right length", () => {
    expect(resample(new Float32Array(44100), 44100, 48000).length).toBe(48000);
  });
});
