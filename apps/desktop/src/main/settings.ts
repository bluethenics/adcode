/**
 * The app-wide settings store, bound to Electron's userData directory.
 *
 * All behaviour lives in `settingsStore.ts`, which has no Electron import so its disk
 * handling can be tested. This file is only the binding.
 */
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

export const writeSetting = (id: string, value: boolean | string): Promise<SettingsValues> =>
  get().write(id, value);

export const onSettingsChanged = (listener: (values: SettingsValues) => void): void =>
  get().onChanged(listener);
