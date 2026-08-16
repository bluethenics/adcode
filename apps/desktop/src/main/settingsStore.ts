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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SETTINGS_VERSION,
  defaultSettings,
  getSetting,
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

export function createSettingsStore(directory: string): SettingsStore {
  const target = join(directory, "settings.json");
  const temporary = `${target}.tmp`;

  let cache: SettingsValues | null = null;
  const listeners: ((values: SettingsValues) => void)[] = [];

  async function persist(values: SettingsValues): Promise<void> {
    await mkdir(directory, { recursive: true });

    // Write-then-rename. A crash midway leaves the previous file intact rather than a
    // truncated one - which the load path would have to treat as corrupt and discard,
    // silently losing every preference the user had set.
    await writeFile(temporary, JSON.stringify({ version: SETTINGS_VERSION, values }, null, 2), "utf8");
    await rename(temporary, target);
  }

  function announce(values: SettingsValues): void {
    for (const listener of listeners) listener({ ...values });
  }

  async function load(): Promise<SettingsValues> {
    if (cache !== null) return cache;

    try {
      const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
      const stored =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { version?: number; values?: Record<string, unknown> })
          : {};

      cache = migrate({ version: stored.version, values: stored.values ?? {} }).values;
    } catch {
      cache = defaultSettings();
    }

    return cache;
  }

  return {
    load,
    current: () => cache ?? defaultSettings(),
    read: async () => ({ ...(await load()) }),

    async write(id: string, value: boolean | string): Promise<SettingsValues> {
      const current = await load();
      const setting = getSetting(id);
      if (setting === undefined) return { ...current };

      const valid =
        setting.kind === "boolean"
          ? typeof value === "boolean"
          : typeof value === "string" && setting.options.some((option) => option.value === value);

      if (!valid) return { ...current };

      cache = { ...current, [id]: value };
      await persist(cache);
      announce(cache);
      return { ...cache };
    },

    async reset(): Promise<SettingsValues> {
      cache = defaultSettings();
      await persist(cache);
      announce(cache);
      return { ...cache };
    },

    onChanged(listener): void {
      listeners.push(listener);
    },
  };
}
