/**
 * Where a user's shortcut changes are kept.
 *
 * A separate file from `settings.json` rather than a row inside it, for one reason: this is
 * the file somebody edits by hand when they have bound something they cannot unbind. It
 * wants to be small, obviously named, and readable without scrolling past sixty unrelated
 * preferences - and it must be safe to delete, which a settings file is not.
 *
 * Fails soft in every direction, like the settings store: a missing, unreadable or corrupt
 * file yields no overrides rather than an error. An editor whose keyboard will not start
 * because of its own keyboard file is a worse outcome than one that forgets a remap.
 *
 * No Electron import, so the disk behaviour can be tested.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isBindableChord, pruneOverrides, type BindingOverrides, type Chord } from "../shared/keybindings.ts";

/** Bumped only if the file's shape changes; a mismatch is treated as no overrides. */
export const KEYBINDINGS_VERSION = 1;

export interface KeybindingsStore {
  load(): Promise<BindingOverrides>;
  /** Current overrides without awaiting; empty before the first load completes. */
  current(): BindingOverrides;
  read(): Promise<BindingOverrides>;
  /**
   * Set one command's shortcut.
   *
   * `null` clears it - which is different from removing the override, and both are
   * reachable: `write(id, null)` says "this command has no shortcut", `reset(id)` says
   * "put back whatever it shipped with".
   */
  write(command: string, chord: Chord | null): Promise<BindingOverrides>;
  /** Forget one command's override, or every one of them. */
  reset(command?: string): Promise<BindingOverrides>;
  onChanged(listener: (overrides: BindingOverrides) => void): void;
}

/**
 * Read one stored entry, or `undefined` if it is not usable.
 *
 * The file is hand-editable by design, so this is the boundary where a hand-written mistake
 * stops. An unbindable chord is dropped rather than stored: honouring `"k"` would give the
 * user an editor that runs a command every time they type the letter k, and the only way
 * out is the file they just broke.
 */
function readEntry(value: unknown): Chord | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return isBindableChord(value) ? value : undefined;
}

export function createKeybindingsStore(directory: string): KeybindingsStore {
  const target = join(directory, "keybindings.json");
  const temporary = `${target}.tmp`;

  let cache: BindingOverrides | null = null;
  const listeners: ((overrides: BindingOverrides) => void)[] = [];

  async function persist(overrides: BindingOverrides): Promise<void> {
    await mkdir(directory, { recursive: true });

    // Write-then-rename, for the same reason the settings store does it: a crash midway
    // leaves the previous file intact rather than a truncated one that the load path would
    // have to discard.
    await writeFile(
      temporary,
      JSON.stringify({ version: KEYBINDINGS_VERSION, overrides }, null, 2),
      "utf8",
    );
    await rename(temporary, target);
  }

  function announce(overrides: BindingOverrides): void {
    for (const listener of listeners) listener({ ...overrides });
  }

  async function load(): Promise<BindingOverrides> {
    if (cache !== null) return cache;

    try {
      const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
      const stored =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { version?: unknown; overrides?: unknown })
          : {};

      if (stored.version !== KEYBINDINGS_VERSION) {
        cache = {};
        return cache;
      }

      const raw = typeof stored.overrides === "object" && stored.overrides !== null
        ? (stored.overrides as Record<string, unknown>)
        : {};

      const kept: Record<string, Chord | null> = {};
      for (const [command, value] of Object.entries(raw)) {
        const entry = readEntry(value);
        if (entry !== undefined) kept[command] = entry;
      }

      // Overrides for commands that no longer exist are dropped on read rather than kept
      // forever, so a file that survives a few releases does not accumulate rows that
      // cannot be seen or removed from the dialog.
      cache = pruneOverrides(kept);
    } catch {
      cache = {};
    }

    return cache;
  }

  return {
    load,
    current: () => cache ?? {},
    read: async () => ({ ...(await load()) }),

    async write(command, chord): Promise<BindingOverrides> {
      const current = await load();
      if (chord !== null && !isBindableChord(chord)) return { ...current };

      cache = { ...current, [command]: chord };
      await persist(cache);
      announce(cache);
      return { ...cache };
    },

    async reset(command): Promise<BindingOverrides> {
      const current = await load();

      if (command === undefined) cache = {};
      else {
        const next = { ...current };
        delete next[command];
        cache = next;
      }

      await persist(cache);
      announce(cache);
      return { ...cache };
    },

    onChanged(listener): void {
      listeners.push(listener);
    },
  };
}
