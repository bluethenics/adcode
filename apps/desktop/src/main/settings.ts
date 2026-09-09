/**
 * The app-wide settings store, bound to Electron's userData directory.
 *
 * All behaviour lives in `settingsStore.ts`, which has no Electron import so its disk
 * handling can be tested. This file is only the binding.
 */
import { parseConnections } from "@adcode/ai";
import { createKeychainStore } from "./keychain.ts";
import { app } from "electron";
import { createSettingsStore, type SettingsStore } from "./settingsStore.ts";
import type { SettingsValues } from "@adcode/settings";

let store: SettingsStore | null = null;

function get(): SettingsStore {
  store ??= createSettingsStore(app.getPath("userData"));
  return store;
}

export const loadSettings = (): Promise<SettingsValues> => get().load();
export const readSettings = (): Promise<SettingsValues> => get().read();
export const currentSettings = (): SettingsValues => get().current();
export const resetSettings = (): Promise<SettingsValues> => get().reset();

export const writeSetting = async (
  id: string,
  value: boolean | string,
): Promise<SettingsValues> => {
  if (id === "adcode.ai.connections") {
    const next = parseConnections(value);
    let previous: ReturnType<typeof parseConnections> = [];
    try {
      previous = parseConnections(get().current()[id] ?? "[]");
    } catch {
      /* Replace invalid imported profiles. */
    }
    const keys = createKeychainStore();
    for (const old of previous) {
      const replacement = next.find((item) => item.id === old.id);
      if (!replacement || replacement.baseUrl !== old.baseUrl)
        await keys.clear(old.id);
    }
    value = JSON.stringify(next);
  }
  return get().write(id, value);
};

export const onSettingsChanged = (
  listener: (values: SettingsValues) => void,
): void => get().onChanged(listener);
