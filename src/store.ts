import type { Ctx } from "./machine";
import type { Card } from "./card";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export const saveSession = (c: Ctx) => set("ow:session", JSON.stringify(c));
export const loadSession = (): Ctx | null => { try { return JSON.parse(get("ow:session") || "null"); } catch { return null; } };
export const saveLetter = (c: Card) => { const l = loadLetters().filter((x) => x.message !== c.message); set("ow:letters", JSON.stringify([c, ...l].slice(0, 50))); };
export const loadLetters = (): Card[] => { try { return JSON.parse(get("ow:letters") || "[]"); } catch { return []; } };
