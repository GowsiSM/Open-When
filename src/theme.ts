// Light/dark handling. The user's preference (system | light | dark) is resolved to a concrete
// mode and written to <html data-mode>. CSS keys every palette off data-mode, so letter styles
// can no longer override the toggle (that was the bug: they only defined light colours).
export type Theme = "system" | "dark" | "light";
export type Mode = "dark" | "light";

export const THEME_COLOR: Record<Mode, string> = { dark: "#0a0a0a", light: "#f1eee6" };
export const resolveMode = (t: Theme, systemDark: boolean): Mode => (t === "system" ? (systemDark ? "dark" : "light") : t);
export const nextTheme = (t: Theme): Theme => (t === "system" ? "light" : t === "light" ? "dark" : "system");
export const themeLabel = (t: Theme) => (t === "system" ? "Auto" : t === "light" ? "Light" : "Dark");

const query = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

/** Writes data-theme (preference), data-mode (resolved) and the browser theme-color. Returns the mode. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): Mode {
  const mode = resolveMode(t, !!query()?.matches);
  root.dataset.theme = t;
  root.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  return mode;
}

/** Re-applies when the OS theme changes (only matters while the preference is "system"). */
export function watchSystem(onChange: () => void): () => void {
  const q = query();
  if (!q) return () => {};
  q.addEventListener?.("change", onChange);
  return () => q.removeEventListener?.("change", onChange);
}
