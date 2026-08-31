/**
 * Whether to ask about pinning ADCode, what to say when asking, and - on the one platform
 * that permits it - how to edit the dock.
 *
 * Pure, and separate from `pinPrompt.ts` for the same reason `@adcode/release` is separate
 * from `main/releases.ts`: the rule about how often somebody may be interrupted is the
 * part worth testing exhaustively, and it should not need an Electron app object to say
 * what it thinks.
 *
 * **Windows cannot pin itself, and this is not an oversight.** Microsoft withdrew the
 * `PinToTaskbar` shell verb in Windows 10 1803, and the supported replacement -
 * `Windows.UI.Shell.TaskbarManager.RequestPinCurrentAppAsync` - is only callable by an app
 * with MSIX package identity, which an NSIS install does not have. The remaining route,
 * writing the pin into `Taskband` and `User Pinned\TaskBar` by hand, is hash-verified by
 * the shell and is also indistinguishable from what malware does to the same keys. So the
 * Windows card asks and then points; the last click is the user's. macOS could be made to
 * work by rewriting `com.apple.dock.plist` and restarting the Dock, and is deliberately
 * left alone - restarting somebody's Dock to save them one menu is not a trade worth
 * making. GNOME's favourites are a documented, per-user GSetting, so Linux gets a button
 * that genuinely does it.
 */

/**
 * The launches on which the card may appear, counted from the first ever run.
 *
 * Two chances and no more. The first is the one that matters; the second exists because a
 * card shown in the first minute of a new editor competes with everything else that is new
 * about it, and gets dismissed by reflex rather than by decision.
 */
export const ASK_ON_LAUNCHES: readonly number[] = [1, 3];

export interface PinPromptState {
  /** How many times this install has started, including the one happening now. */
  readonly launches: number;
  /** They pinned it, or they said not to ask again. Either way the question is closed. */
  readonly settled: boolean;
  /** The launch numbers on which the card has already been drawn. */
  readonly shownAt: readonly number[];
}

export type PinPromptDecision =
  | { readonly show: true }
  | {
      readonly show: false;
      readonly reason: "settled" | "already-asked" | "resting" | "exhausted";
    };

export function decidePinPrompt(state: PinPromptState): PinPromptDecision {
  if (state.settled) return { show: false, reason: "settled" };
  if (state.shownAt.includes(state.launches)) return { show: false, reason: "already-asked" };

  const last = ASK_ON_LAUNCHES[ASK_ON_LAUNCHES.length - 1] ?? 0;
  if (state.launches > last) return { show: false, reason: "exhausted" };
  if (!ASK_ON_LAUNCHES.includes(state.launches)) return { show: false, reason: "resting" };

  return { show: true };
}

/* ── Whether there is anything to ask ─────────────────────────────────── */

export interface PinEnvironment {
  readonly platform: NodeJS.Platform;
  /** False under `electron-vite dev` and under `scripts/smoke.mjs`. */
  readonly packaged: boolean;
  /** electron-builder's portable target, which runs from a temp directory. */
  readonly portable: boolean;
  /** Windows: a Start Menu shortcut carrying this app's AppUserModelID exists. */
  readonly shortcutInstalled: boolean;
  /** Linux: a GNOME-derived session, with a desktop entry installed to pin. */
  readonly dockEditable: boolean;
  /** `ADCODE_PIN_PROMPT=1`. The smoke run's only way to see the card. */
  readonly forced: boolean;
}

export type PinEligibility =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: "unsupported" | "unpackaged" | "portable" | "no-shortcut" | "no-dock";
    };

/**
 * Whether pinning can actually succeed here. Asking otherwise is worse than not asking.
 *
 * **Windows hides "Pin to taskbar" unless the AppUserModelID resolves to a shortcut.** The
 * shell looks the running window's ID up among the Start Menu shortcuts, and drops the pin
 * entry from the jump list when it finds nothing - so `app.setAppUserModelId` in
 * `index.ts`, which runs in development too, is precisely what removes the option during a
 * dev run. The NSIS installer stamps the same ID onto both shortcuts it writes, which is
 * what makes an installed build work; the portable build writes no shortcut at all, so it
 * never will. A card that says "right-click it and choose Pin to taskbar" in either of
 * those is instructing somebody to find a menu entry that is not there.
 *
 * macOS needs no shortcut - the Dock offers Keep in Dock for any running application - but
 * still wants a packaged build, or the card offers to keep `node_modules`' stock Electron
 * binary in somebody's Dock forever.
 */
export function pinEligibility(environment: PinEnvironment): PinEligibility {
  if (pinPromptContent(environment.platform) === null) {
    return { eligible: false, reason: "unsupported" };
  }

  // Deliberately after the platform check and before every other one: forcing exists to
  // let the smoke run drive an unpackaged build, not to invent a dock that is not there.
  if (environment.forced) return { eligible: true };

  if (!environment.packaged) return { eligible: false, reason: "unpackaged" };

  if (environment.platform === "win32") {
    if (environment.portable) return { eligible: false, reason: "portable" };
    if (!environment.shortcutInstalled) return { eligible: false, reason: "no-shortcut" };
  }

  if (environment.platform === "linux" && !environment.dockEditable) {
    return { eligible: false, reason: "no-dock" };
  }

  return { eligible: true };
}

export interface PinPromptContent {
  readonly title: string;
  readonly body: string;
  /** What to do by hand. Shown on request, and on Linux only when the button failed. */
  readonly steps: readonly string[];
  /** The label on a button that really pins, or null where the OS forbids one. */
  readonly pinLabel: string | null;
  /** The label on the button that reveals `steps`. */
  readonly howLabel: string;
}

/**
 * What the card says, or null on a platform with no dock this can speak about - in which
 * case nothing is ever asked. Being asked to pin an app to a taskbar that is not there is
 * worse than never being asked at all.
 */
export function pinPromptContent(platform: NodeJS.Platform): PinPromptContent | null {
  if (platform === "win32") {
    return {
      title: "Keep ADCode on your taskbar",
      body: "Pin it once and it is always where you left it - no Start menu, no searching.",
      steps: [
        "Find the ADCode icon on your taskbar - it is there now, while ADCode is running.",
        "Right-click it.",
        "Choose Pin to taskbar.",
      ],
      pinLabel: null,
      howLabel: "Show me how",
    };
  }

  if (platform === "darwin") {
    return {
      title: "Keep ADCode in your Dock",
      body: "Keep it in the Dock and it is always one click away, whether or not it is open.",
      steps: [
        "Find the ADCode icon in your Dock - it is there now, while ADCode is running.",
        "Right-click it, or Control-click it.",
        "Choose Options, then Keep in Dock.",
      ],
      pinLabel: null,
      howLabel: "Show me how",
    };
  }

  if (platform === "linux") {
    return {
      title: "Keep ADCode in your dock",
      body: "Add it to your favourites and it stays in the dock after this window closes.",
      steps: [
        "Find the ADCode icon in your dock - it is there now, while ADCode is running.",
        "Right-click it.",
        "Choose Add to Favourites, or Pin to Dash.",
      ],
      pinLabel: "Pin it for me",
      howLabel: "Show me how",
    };
  }

  return null;
}

/* ── GNOME favourites ─────────────────────────────────────────────────── */

/**
 * Read the list `gsettings get org.gnome.shell favorite-apps` prints.
 *
 * The output is GVariant, not JSON: single quotes, and a typed `@as []` for the empty
 * list rather than `[]`. Anything unreadable is treated as an empty dock, which is safe
 * in one direction only - `withFavorite` appends, so the worst case is a dock that gains
 * ADCode and keeps everything else, never one that loses an entry.
 */
export function parseFavorites(raw: string): readonly string[] {
  const inside = raw.trim().replace(/^@as\s*/, "");
  if (!inside.startsWith("[") || !inside.endsWith("]")) return [];

  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of inside.slice(1, -1)) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "'") {
      if (quoted) entries.push(current);
      current = "";
      quoted = !quoted;
    } else if (quoted) {
      current += character;
    }
  }

  return entries;
}

/** Write a list back in the form gsettings accepts. */
export function formatFavorites(entries: readonly string[]): string {
  if (entries.length === 0) return "@as []";
  const quoted = entries.map((entry) => `'${entry.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  return `[${quoted.join(", ")}]`;
}

/** Append the entry unless it is already pinned. Idempotent, so a second click is free. */
export function withFavorite(entries: readonly string[], id: string): readonly string[] {
  return entries.includes(id) ? entries : [...entries, id];
}
