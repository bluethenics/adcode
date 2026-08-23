/**
 * The app-wide keybinding overrides, bound to Electron's userData directory.
 *
 * All behaviour lives in `keybindingsStore.ts`, which has no Electron import so its disk
 * handling can be tested. This file is only the binding - the same split as `settings.ts`.
 */
import { app } from "electron";
import { createKeybindingsStore, type KeybindingsStore } from "./keybindingsStore.ts";
import type { BindingOverrides, Chord } from "../shared/keybindings.ts";

let store: KeybindingsStore | null = null;

function get(): KeybindingsStore {
  store ??= createKeybindingsStore(app.getPath("userData"));
  return store;
}

export const loadKeybindings = (): Promise<BindingOverrides> => get().load();
export const readKeybindings = (): Promise<BindingOverrides> => get().read();

/**
 * The overrides without awaiting.
 *
 * `installApplicationMenu` needs them synchronously - it is called from a dozen places that
 * are not about keybindings - and it is always called after `loadKeybindings` has run
 * during startup, so the cache is warm by the time a menu is built.
 */
export const currentKeybindings = (): BindingOverrides => get().current();

export const writeKeybinding = (command: string, chord: Chord | null): Promise<BindingOverrides> =>
  get().write(command, chord);

export const resetKeybindings = (command?: string): Promise<BindingOverrides> => get().reset(command);

export const onKeybindingsChanged = (listener: (overrides: BindingOverrides) => void): void =>
  get().onChanged(listener);
