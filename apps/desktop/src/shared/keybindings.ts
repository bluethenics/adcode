/**
 * What every shortcut is bound to, and how a user changes one.
 *
 * There were two lists before this file: the accelerators on `menuModel.ts`, which the main
 * process registers with Electron, and a `KEYBINDINGS` array in the renderer that the
 * keydown handler walks. They overlapped almost exactly, neither knew about the other, and
 * a shortcut could be changed in one and not the other with nothing to catch it. Since the
 * whole point of this file is to let a *user* change one, that arrangement had to go first:
 * an override that moved the keyboard but not the menu's printed label would be worse than
 * no feature at all.
 *
 * So the menu model is the source of truth for what a shortcut *is*, this file resolves it
 * against the user's overrides, and both consumers read the result.
 *
 * Pure. No Electron, no DOM, no disk - which is what lets chord parsing, the platform
 * differences, and conflict detection be tested without a window.
 */
import { buildMenuBar, stripMnemonic, type MenuEntry, type MenuTop } from "./menuModel.ts";

/** The whole bar. `menuModel` returns this shape without naming it. */
export type MenuBar = readonly MenuTop[];

/**
 * A chord in Electron's accelerator syntax: `CmdOrCtrl+Shift+P`.
 *
 * Electron's syntax rather than a shape of our own, because Electron is the thing that has
 * to accept it. A private format would need converting at exactly the point where a mistake
 * becomes a shortcut that silently does not work.
 */
export type Chord = string;

/** A chord broken into the four things a keydown event can be compared against. */
export interface ParsedChord {
  /** Lowercased for single characters; as-written for named keys (`F11`, `PageDown`). */
  readonly key: string;
  /** `CmdOrCtrl`, `Cmd`, `Command`, `Control` or `Ctrl`. */
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface Binding {
  readonly command: string;
  /** The menu's label with its `&` mnemonic stripped: "Toggle Full Screen". */
  readonly title: string;
  /** The menu this came from, which is how the dialog groups its rows. */
  readonly group: string;
  /** `null` means unbound - either by default, or because the user cleared it. */
  readonly chord: Chord | null;
  /** The shortcut before any override, so a changed row can say what it was. */
  readonly defaultChord: Chord | null;
  /**
   * True when Electron's own implementation handles this row.
   *
   * Copy, paste and undo reach the focused native control, which no renderer message can
   * do reliably. Rebinding one would take the shortcut away from the control that needs it,
   * so the dialog shows these and refuses to change them - visibly, with a reason, rather
   * than by leaving them off the list and inviting the question of where Copy went.
   */
  readonly nativeRole: boolean;
}

/** `commandId` to chord. `null` clears a default binding rather than restoring it. */
export type BindingOverrides = Readonly<Record<string, Chord | null>>;

/* ── Parsing and formatting ───────────────────────────────────────────────── */

const MODIFIER_ALIASES: Readonly<Record<string, keyof Omit<ParsedChord, "key">>> = {
  cmdorctrl: "mod",
  commandorcontrol: "mod",
  cmd: "mod",
  command: "mod",
  ctrl: "mod",
  control: "mod",
  shift: "shift",
  alt: "alt",
  option: "alt",
};

/**
 * Split a chord into its parts, or `null` if it is not one.
 *
 * `null` rather than a partial result: an unparseable chord must never become a binding
 * that matches something unintended, and the two ways to get one - a corrupt overrides file
 * and a hand-edited one - both deserve to be ignored rather than half-honoured.
 */
export function parseChord(chord: string): ParsedChord | null {
  const parts = chord.split("+").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  let mod = false;
  let shift = false;
  let alt = false;
  let key: string | null = null;

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];

    if (modifier === "mod") mod = true;
    else if (modifier === "shift") shift = true;
    else if (modifier === "alt") alt = true;
    else if (key !== null) return null; // Two keys is not a chord.
    else key = part;
  }

  if (key === null) return null;

  return { key: key.length === 1 ? key.toLowerCase() : key, mod, shift, alt };
}

/** What a keydown event would be, as a chord. `null` for a bare modifier press. */
export function chordFromEvent(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): Chord | null {
  // Pressing Shift on its own is not a shortcut, and a recorder that accepted it would
  // capture the first half of every chord anybody tried to enter.
  if (["Control", "Meta", "Shift", "Alt", "AltGraph", "CapsLock", "Dead"].includes(event.key)) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CmdOrCtrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  /*
   * The *physical* key, upper-cased, not the character it produced.
   *
   * With Shift held, `event.key` for the `1` key is `!` on a US layout and something else
   * on every other - so recording the character would store a chord that only reproduces on
   * the keyboard it was recorded on. Single characters are normalised to upper case, which
   * is the form Electron's accelerators use.
   */
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);

  return parts.join("+");
}

/** Does this event press this chord? */
export function matchesChord(chord: ParsedChord, event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (pressed !== chord.key.toLowerCase() && pressed !== chord.key) return false;
  if (chord.mod !== (event.ctrlKey || event.metaKey)) return false;
  if (chord.shift !== event.shiftKey) return false;
  if (chord.alt !== event.altKey) return false;

  return true;
}

/**
 * A chord a person can read: `Ctrl+Shift+P`, or `⌘⇧P` on a Mac.
 *
 * The same rendering `menuModel.formatAccelerator` does, restated here so the dialog does
 * not have to import the menu model to print a row - and kept identical, because a shortcut
 * printed two ways is a shortcut the reader stops believing.
 */
export function formatChord(chord: Chord, platform: string): string {
  if (platform === "darwin") {
    return chord
      .replace(/CmdOrCtrl|Cmd|Command/g, "⌘")
      .replace(/Ctrl|Control/g, "⌃")
      .replace(/Alt|Option/g, "⌥")
      .replace(/Shift/g, "⇧")
      .replace(/\+/g, "");
  }

  return chord.replace(/CmdOrCtrl|Cmd|Command/g, "Ctrl").replace(/Option/g, "Alt");
}

/**
 * Is this a chord worth storing?
 *
 * A bare letter is refused. Binding `k` to "Kill Terminal" would make the editor
 * unusable the moment the user typed the letter k, and there is no way back from that
 * except editing the file by hand - which the person who needs it least is the only one
 * who can do.
 */
export function isBindableChord(chord: Chord): boolean {
  const parsed = parseChord(chord);
  if (parsed === null) return false;

  // Function keys and the navigation cluster stand alone; everything else needs a modifier.
  const standalone = /^(F\d{1,2}|Escape|Insert|Delete|Home|End|PageUp|PageDown|Pause)$/.test(parsed.key);
  if (standalone) return true;

  if (!parsed.mod && !parsed.alt) return false;

  /*
   * Shift alone is not enough either.
   *
   * `Shift+A` is how you type a capital A, and a binding on it fires on every capital
   * letter in every text box in the window. This is only reachable through the `mod`/`alt`
   * check above, so it is a belt-and-braces guard on the one case that would be silently
   * catastrophic.
   */
  return true;
}

/* ── The binding list ─────────────────────────────────────────────────────── */

/** Walk the menu, collecting every row that carries a shortcut or could carry one. */
function collect(bar: MenuBar): Binding[] {
  const bindings: Binding[] = [];
  const seen = new Set<string>();

  const walk = (entries: readonly MenuEntry[], group: string): void => {
    for (const entry of entries) {
      if ("kind" in entry && entry.kind === "separator") continue;

      if ("kind" in entry && entry.kind === "submenu") {
        walk(entry.items, group);
        continue;
      }

      /*
       * Rows that act on an argument are skipped.
       *
       * A recent folder is ten menu rows sharing one command id, and binding a key to
       * "open the folder that happens to be third in the list today" is not a shortcut
       * anybody wants. `menuModel` already keeps these off the palette for the same reason.
       */
      if (entry.arg !== undefined) continue;
      if (seen.has(entry.command)) continue;

      seen.add(entry.command);
      bindings.push({
        command: entry.command,
        title: stripMnemonic(entry.label),
        group,
        chord: entry.accelerator ?? null,
        defaultChord: entry.accelerator ?? null,
        nativeRole: entry.role !== undefined,
      });
    }
  };

  for (const top of bar) walk(top.items, stripMnemonic(top.label));
  return bindings;
}

/**
 * Every shortcut, with the user's changes applied.
 *
 * Built from the menu rather than from a second list, so a command added to the menu is
 * rebindable the same day without anybody remembering to add it here.
 */
export function resolveBindings(overrides: BindingOverrides = {}, bar: MenuBar = buildMenuBar()): Binding[] {
  return collect(bar).map((binding) => {
    // `null` is a real value here and means "the user cleared this", which is not the same
    // as "no override" - so the key's presence is the test, not its truthiness.
    if (!Object.hasOwn(overrides, binding.command)) return binding;

    const chord = overrides[binding.command] ?? null;
    if (chord !== null && !isBindableChord(chord)) return binding;

    return { ...binding, chord };
  });
}

/**
 * Chords claimed by more than one command.
 *
 * Returned rather than prevented. Two commands on one chord is a real state - the defaults
 * could grow one, and a half-finished remap passes through one - and the dialog's job is to
 * point at it, not to refuse the keystroke that produced it. Native roles are excluded
 * because Electron resolves those itself and they cannot be changed anyway.
 */
export function conflicts(bindings: readonly Binding[]): Map<Chord, string[]> {
  const byChord = new Map<Chord, string[]>();

  for (const binding of bindings) {
    if (binding.chord === null || binding.nativeRole) continue;

    const claimants = byChord.get(binding.chord) ?? [];
    claimants.push(binding.command);
    byChord.set(binding.chord, claimants);
  }

  for (const [chord, claimants] of byChord) {
    if (claimants.length < 2) byChord.delete(chord);
  }

  return byChord;
}

/**
 * The menu, with the user's shortcuts written onto it.
 *
 * Both the native menu and the drawn one go through this, which is the mechanism that keeps
 * the printed accelerator and the working key the same thing. A menu built from the raw
 * model would show the factory shortcut next to a command that no longer answers to it.
 */
export function applyOverrides(bar: MenuBar, overrides: BindingOverrides): MenuBar {
  const rewrite = (entries: readonly MenuEntry[]): MenuEntry[] =>
    entries.map((entry) => {
      if ("kind" in entry && entry.kind === "separator") return entry;
      if ("kind" in entry && entry.kind === "submenu") return { ...entry, items: rewrite(entry.items) };

      if (entry.arg !== undefined || !Object.hasOwn(overrides, entry.command)) return entry;

      const chord = overrides[entry.command] ?? null;
      if (chord !== null && !isBindableChord(chord)) return entry;

      // The property is removed rather than set to undefined: `exactOptionalPropertyTypes`
      // is on, and the menu builders both test for the key's absence.
      const { accelerator: _dropped, ...rest } = entry;
      return chord === null ? rest : { ...rest, accelerator: chord };
    });

  return bar.map((top) => ({ ...top, items: rewrite(top.items) }));
}

/** Drop overrides that no longer name a command, so a stale file cannot grow forever. */
export function pruneOverrides(overrides: BindingOverrides, bar: MenuBar = buildMenuBar()): BindingOverrides {
  const known = new Set(collect(bar).map((binding) => binding.command));
  const kept: Record<string, Chord | null> = {};

  for (const [command, chord] of Object.entries(overrides)) {
    if (known.has(command)) kept[command] = chord;
  }

  return kept;
}
