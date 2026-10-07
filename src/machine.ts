// Deterministic experience state machine. UI only dispatches events; no logic lives in components.
import type { Card } from "./card";
import type { Level } from "./detector";

export type Phase = "home" | "create" | "seal" | "ready" | "listening" | "searching" | "near" | "confirmed" | "unlock" | "message" | "summary";
export interface Ctx { phase: Phase; card: Card | null; startedAt: number | null; listenStartedAt: number | null; listenMs: number; foundAt: number | null }
export type Ev =
  | { t: "CREATE" } | { t: "SEALED"; card: Card } | { t: "RECEIVE"; card: Card } | { t: "ACK" }
  | { t: "BEGIN"; now: number } | { t: "FIELD" } | { t: "SIGNAL"; level: Level } | { t: "STOP"; now: number }
  | { t: "CONFIRMED"; now: number } | { t: "OPEN" } | { t: "FINISH" } | { t: "HOME" };

export const INITIAL: Ctx = { phase: "home", card: null, startedAt: null, listenStartedAt: null, listenMs: 0, foundAt: null };
export const inField = (p: Phase) => p === "listening" || p === "searching" || p === "near";

export function reduce(c: Ctx, e: Ev): Ctx {
  const p = c.phase;
  if (e.t === "HOME" && p !== "listening" && p !== "searching" && p !== "near" && p !== "confirmed") return INITIAL;
  switch (e.t) {
    case "CREATE": return p === "home" ? { ...c, phase: "create" } : c;
    case "SEALED": return p === "create" ? { ...INITIAL, phase: "seal", card: e.card } : c;
    case "RECEIVE": return p === "home" ? { ...INITIAL, phase: "ready", card: e.card } : c;
    case "ACK": return p === "seal" ? { ...c, phase: "ready" } : p === "confirmed" ? { ...c, phase: "unlock" } : c;
    case "BEGIN": return p === "ready" ? { ...c, phase: "listening", startedAt: c.startedAt ?? e.now, listenStartedAt: e.now } : c;
    case "FIELD": return p === "listening" ? { ...c, phase: "searching" } : c;
    case "SIGNAL":
      if (!inField(p)) return c;
      if (e.level === "medium" || e.level === "high") return p === "near" ? c : { ...c, phase: "near" };
      return p === "near" ? { ...c, phase: "searching" } : c;
    case "STOP": return inField(p) ? { ...c, phase: "ready", listenMs: c.listenMs + (e.now - (c.listenStartedAt ?? e.now)), listenStartedAt: null } : c;
    case "CONFIRMED": return inField(p) ? { ...c, phase: "confirmed", foundAt: e.now, listenMs: c.listenMs + (e.now - (c.listenStartedAt ?? e.now)), listenStartedAt: null } : c;
    case "OPEN": return p === "unlock" ? { ...c, phase: "message" } : c;
    case "FINISH": return p === "message" ? { ...c, phase: "summary" } : c;
    default: return c;
  }
}

// After a reload the mic needs a fresh tap, so a live session comes back as "ready" with its clock intact.
export function recover(s: Ctx | null): Ctx {
  if (!s || !s.card) return INITIAL;
  if (inField(s.phase) || s.phase === "seal") return { ...s, phase: "ready", listenMs: s.listenMs + (s.listenStartedAt ? Date.now() - s.listenStartedAt : 0), listenStartedAt: null };
  if (s.phase === "confirmed") return { ...s, phase: "unlock" };
  return ["ready", "unlock", "message", "summary"].includes(s.phase) ? s : INITIAL;
}
