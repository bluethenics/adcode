/**
 * Settings persistence, with no Electron import - so the disk behaviour that protects a
 * user's preferences can actually be tested.
 *
 * The schema, defaults, validation, and migration live in `@adcode/settings`, which has
 * no I/O at all. This is only the disk half.
 *
 * It fails soft in every direction: a missing, unreadable, or corrupt settings file
 * yields defaults rather than an error. An editor that will not start because of its own
 * preferences file is worse than one that forgets a preference.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicReplace } from "./atomicReplace.ts";
import {
  SETTINGS_VERSION,
  defaultSettings,
  getSetting,
  isValidSettingValue,
  migrate,
  type SettingsValues,
} from "@adcode/settings";

export interface SettingsStore {
  load(): Promise<SettingsValues>;
  /** Current values without awaiting; defaults before the first load completes. */
  current(): SettingsValues;
  read(): Promise<SettingsValues>;
  write(id: string, value: boolean | string): Promise<SettingsValues>;
  reset(): Promise<SettingsValues>;
  onChanged(listener: (values: SettingsValues) => void): void;
}

export function createSettingsStore(directory: string, io: {
  readonly replace?: typeof atomicReplace;
  readonly copy?: typeof copyFile;
} = {}): SettingsStore {
  const target = join(directory, "settings.json");
  const temporary = `${target}.tmp`;
  const backup = `${target}.bak`;
  const replace = io.replace ?? atomicReplace;
  const copy = io.copy ?? copyFile;

  let cache: SettingsValues | null = null;
  let recoveredFromBackup = false;
  let serial = Promise.resolve();
  const listeners: ((values: SettingsValues) => void)[] = [];
  const encode = (values: SettingsValues): string => JSON.stringify({ version: SETTINGS_VERSION, values }, null, 2);

  async function persist(values: SettingsValues, previous: SettingsValues): Promise<void> {
    await mkdir(directory, { recursive: true });

    // Write-then-rename. A crash midway leaves the previous file intact rather than a
    // truncated one - which the load path would have to treat as corrupt and discard,
    // silently losing every preference the user had set.
    await writeFile(temporary, encode(values), "utf8");
    try {
      await replace(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EXDEV") throw error;
      // Store-virtualized Windows paths can reject even a sibling rename. Keep the
      // last validated state before a non-atomic copy can touch the destination.
      if (!recoveredFromBackup) await writeFile(backup, encode(previous), "utf8");
      recoveredFromBackup = true;
      await copy(temporary, target);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    recoveredFromBackup = false;
  }

  function announce(values: SettingsValues): void {
    for (const listener of listeners) listener({ ...values });
  }

  async function load(): Promise<SettingsValues> {
    if (cache !== null) return cache;

    for (const file of [target, backup]) {
      try {
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        const stored = parsed as { version?: number; values?: Record<string, unknown> };
        if (stored.values !== undefined && (typeof stored.values !== "object" || stored.values === null || Array.isArray(stored.values))) continue;
        // A parallel first read may finish after a successful write initialized cache.
        if (cache !== null) return cache;
        cache = migrate({ version: stored.version, values: stored.values ?? {} }).values;
        recoveredFromBackup = file === backup;
        return cache;
      } catch { /* A copy interrupted mid-write can recover from the validated backup. */ }
    }
    cache ??= defaultSettings();
    return cache;
  }

  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    load,
    current: () => cache ?? defaultSettings(),
    read: async () => ({ ...(await load()) }),

    write(id: string, value: boolean | string): Promise<SettingsValues> {
      return mutate(async () => {
        const current = await load();
        const setting = getSetting(id);
        if (setting === undefined) return { ...current };

        // The package's own validator, not a copy of it. The copy that used to live here did
        // not learn about the `text` kind when it was added, and silently rejected every
        // write to it - a write that returns the unchanged settings looks exactly like a
        // setting that does not work.
        if (!isValidSettingValue(setting, value)) return { ...current };

        const next = { ...current, [id]: value };
        await persist(next, current);
        cache = next;
        announce(cache);
        return { ...cache };
      });
    },

    reset(): Promise<SettingsValues> {
      return mutate(async () => {
        const previous = await load();
        const next = defaultSettings();
        await persist(next, previous);
        cache = next;
        announce(cache);
        return { ...cache };
      });
    },

    onChanged(listener): void {
      listeners.push(listener);
    },
  };
}
