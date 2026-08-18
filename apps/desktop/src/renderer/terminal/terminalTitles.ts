/**
 * What a terminal tab is called.
 *
 * Tabs used to be numbered - "Terminal 1", "Terminal 2" - which was fine while every
 * terminal ran the same shell and useless the moment they do not. With a profile launcher
 * the tab strip is the only thing that says which of them is cmd and which is Git Bash, so
 * the shell's own name is the title, and the number only appears when it has to.
 *
 * Pure, so the awkward cases - a shell opened three times, a tab closed from the middle,
 * a shell whose label already ends in a number - are exercised without a pty.
 */

/**
 * A title for a new terminal running `label`, unique among `existing`.
 *
 * Numbering starts at the first free suffix rather than at `existing.length`, so closing
 * "cmd (2)" and opening another cmd reuses the gap instead of jumping to "cmd (3)" and
 * leaving the strip looking like a tab went missing.
 */
export function uniqueTerminalTitle(label: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(label)) return label;

  for (let n = 2; ; n++) {
    const candidate = `${label} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
