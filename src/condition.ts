// Conditions are data. Only single "hear" atoms run today; the shape allows HEAR+SEE, THEN, REACH later.
import { conditionPhrase } from "./card";
export type Mode = "hear" | "see" | "find" | "reach" | "notice";
export interface Atom { mode: Mode; phrase: string }
export interface Condition { op: "ALL" | "THEN"; atoms: Atom[] }
export const SUPPORTED: Mode[] = ["hear"];

export function parseCondition(text: string): { ok: true; cond: Condition } | { ok: false; reason: string } {
  const body = text.toLowerCase().replace(/[.!?"]/g, "").replace(/^\s*open\s+when\s+/, "").trim();
  if (!body) return { ok: false, reason: "Say what the world has to sound like." };
  const op = / then /.test(body) ? "THEN" : "ALL";
  const atoms: Atom[] = body.split(/ then | and | \+ /).map((part) => {
    const m = part.trim().match(/^(?:you\s+)?(hear|see|find|reach|notice)\s+(.+)$/);
    return m ? { mode: m[1] as Mode, phrase: m[2].trim() } : { mode: "hear" as Mode, phrase: conditionPhrase(part) };
  });
  if (atoms.some((a) => !a.phrase)) return { ok: false, reason: "Finish the condition." };
  if (atoms.some((a) => !SUPPORTED.includes(a.mode))) return { ok: false, reason: "Only “hear” conditions work so far." };
  if (atoms.length > 1) return { ok: false, reason: "One sound at a time for now." };
  return { ok: true, cond: { op, atoms } };
}

/** done[i] = atom i confirmed. THEN requires order. */
export const isSatisfied = (c: Condition, done: boolean[]) =>
  c.op === "ALL" ? c.atoms.every((_, i) => done[i]) : c.atoms.every((_, i) => done[i] && (i === 0 || done[i - 1]));
