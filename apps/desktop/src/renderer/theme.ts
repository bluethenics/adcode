/**
 * Turning the appearance setting into a theme.
 *
 * Four values go in, three come out. `system` is not a theme - it is a way of declining
 * to choose - and this is where that declination becomes an answer.
 *
 * Pure, and separate from `main.ts`, because the interesting part is a rule rather than a
 * DOM update: Midnight must **not** follow the operating system. Someone who picks it has
 * picked a look, not a brightness, and an editor that flipped them into Light at sunrise
 * would be overruling them. That is one line of code and exactly the kind of line that
 * gets "simplified" back out by someone tidying up the conditional.
 */
import type { ThemeChoice } from "../shared/api.ts";

const THEMES: ReadonlySet<string> = new Set<ThemeChoice>(["light", "dark", "midnight"]);

export function resolveTheme(preference: unknown, systemPrefersDark: boolean): ThemeChoice {
  // An explicit choice is honoured, whatever the machine thinks. Anything else - `system`,
  // an absent setting, a value from a newer build - falls back to the machine, which is
  // the safe answer for a value this one does not recognise.
  if (typeof preference === "string" && THEMES.has(preference)) return preference as ThemeChoice;
  return systemPrefersDark ? "dark" : "light";
}
