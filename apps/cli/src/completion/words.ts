/**
 * The CLI's vocabulary, kept free of heavy imports.
 *
 * Shell completion runs on every Tab press, so it cannot afford the full startup (desktop
 * profile, account, catalogue). Everything it needs to know about commands and flags lives
 * here, and the argument parser reads the same list so the two cannot drift apart.
 */

/** Every flag parseFlags accepts. */
export const KNOWN_FLAGS: readonly string[] = [
  "--json", "--snapshot", "--live", "--all", "--no-color", "--ascii", "--no-motion", "--no-ads",
  "--continue", "--refresh", "--verbose", "--width", "--height", "--provider", "--model",
  "--theme", "--session", "--effort", "--help", "--version",
];

/** Flags that take the next word as their value. */
export const VALUE_FLAGS: readonly string[] = ["--width", "--height", "--provider", "--model", "--theme", "--session", "--effort"];

export const EFFORT_LEVELS: readonly string[] = ["auto", "low", "medium", "high", "max"];

export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type ShellName = (typeof SHELLS)[number];

/** The actions each command takes as its first argument. */
export const COMMAND_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  models: ["list", "use", "search", "refresh"],
  sessions: ["list", "open", "show", "delete", "rename", "export"],
  theme: ["list", "set", "show"],
  completion: [...SHELLS, "install"],
};

/** Actions whose next argument is a saved conversation. */
export const SESSION_ACTIONS: readonly string[] = ["open", "show", "delete", "rename", "export"];
