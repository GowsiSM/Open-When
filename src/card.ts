// A card is a tiny payload encoded into the URL hash. No backend.
export type LetterTheme = "old" | "field" | "dove";
export const LETTER_THEMES: { id: LetterTheme; name: string; blurb: string }[] = [
  { id: "old", name: "The old letter", blurb: "Warm paper, ink, a wax seal." },
  { id: "field", name: "Field letter", blurb: "Notebook paper, an instruction to go outside." },
  { id: "dove", name: "Dove / memory", blurb: "Quiet, personal. A dove carries it." },
];
export const themeOf = (c: { th?: string } | null | undefined): LetterTheme => (LETTER_THEMES.some((t) => t.id === c?.th) ? (c!.th as LetterTheme) : "field");

export interface Card {
  th: LetterTheme;
  v: 1;
  title: string;
  condition: string;
  message: string;
  from?: string;
}

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function makeCard(input: { condition: string; message: string; title?: string; from?: string; theme?: string }): Card {
  const condition = input.condition.trim();
  const message = input.message.trim();
  if (!condition) throw new Error("Add a condition.");
  if (!message) throw new Error("Write a message.");
  return {
    v: 1,
    th: themeOf({ th: input.theme }),
    title: input.title?.trim() || "Open when",
    condition,
    message,
    ...(input.from?.trim() ? { from: input.from.trim() } : {}),
  };
}

export const encodeCard = (c: Card) => toB64(JSON.stringify(c));

export function decodeCard(payload: string): Card | null {
  try {
    const o = JSON.parse(fromB64(payload));
    if (o?.v !== 1 || typeof o.condition !== "string" || typeof o.message !== "string") return null;
    return makeCard({ condition: o.condition, message: o.message, title: o.title, from: o.from, theme: o.th });
  } catch {
    return null;
  }
}

export const cardUrl = (c: Card, base: string) => `${base.split("#")[0].split("?")[0]}#c=${encodeCard(c)}`;

// A link built on localhost / a LAN address only works on the machine that made it.
export function isLocalBase(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "[::1]" || h.endsWith(".local");
  } catch { return true; }
}

export function cardFromHash(hash: string): Card | null {
  const m = hash.match(/c=([^&]+)/);
  return m ? decodeCard(m[1]) : null;
}

// "Open when you hear running water" -> "running water"
export function conditionPhrase(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[.!?"]/g, "")
      .replace(/^\s*open\s+when\s+/, "")
      .replace(/^\s*when\s+/, "")
      .replace(/^\s*(you\s+)?(can\s+)?(hear|listen to)\s+/, "")
      .trim() || text.trim()
  );
}
