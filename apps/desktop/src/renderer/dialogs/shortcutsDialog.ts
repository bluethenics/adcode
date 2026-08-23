/**
 * Keyboard shortcuts - the list, and the way to change one.
 *
 * What was here before was a toast: every accelerator on the menu, joined with newlines,
 * dumped into a notification that dismissed itself after fifteen seconds. It could not be
 * searched, could not be scrolled, could not be read at leisure, and could not be acted on.
 * A reference you are racing against a timer is not a reference.
 *
 * This is the replacement. Every command the menu knows about, grouped by menu, filterable,
 * and each row's shortcut is a button: press it, then press the keys you want, and that is
 * the binding. It writes through to the main process, which rewrites the application menu -
 * so the change reaches Electron's own accelerator registration and not just this list.
 *
 * **Recording swallows the keyboard, and that is the hard part.** While a row is recording,
 * every keydown in the window belongs to it: not the shortcut it happens to match, not
 * Escape closing the dialog, not Ctrl+S saving the file. Anything less means the shortcut
 * you are trying to record fires instead of being recorded, and the shortcuts worth
 * changing are exactly the ones already bound to something.
 */
import {
  chordFromEvent,
  conflicts,
  formatChord,
  isBindableChord,
  type Binding,
  type BindingOverrides,
  type Chord,
} from "../../shared/keybindings.ts";
import { ICON, createIcon } from "../workbench/icons.ts";

export interface ShortcutsDialogDeps {
  /** Every binding, already resolved against the current overrides. */
  readonly bindings: () => readonly Binding[];
  readonly platform: () => string;
  /** `null` clears the shortcut; the promise resolves once it has been written. */
  readonly setChord: (command: string, chord: Chord | null) => Promise<BindingOverrides>;
  /** Undefined resets every override at once. */
  readonly resetChord: (command?: string) => Promise<BindingOverrides>;
}

export interface ShortcutsDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Redraw from `deps.bindings()`. Called when the overrides change anywhere. */
  refresh(): void;
  /**
   * True while a row is capturing keys.
   *
   * The window's own keydown handler asks before doing anything, which is what stops the
   * chord being recorded from also running the command it is currently bound to.
   */
  isRecording(): boolean;
}

export function createShortcutsDialog(host: HTMLElement, deps: ShortcutsDialogDeps): ShortcutsDialog {
  const dialog = document.createElement("dialog");
  dialog.className = "shortcuts-dialog";

  const card = document.createElement("div");
  card.className = "shortcuts-card";

  const header = document.createElement("header");
  header.className = "shortcuts-header";

  const title = document.createElement("h2");
  title.className = "shortcuts-title";
  title.textContent = "Keyboard shortcuts";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "shortcuts-search";
  search.placeholder = "Search commands and keys";
  search.setAttribute("aria-label", "Search keyboard shortcuts");

  const resetAll = document.createElement("button");
  resetAll.type = "button";
  resetAll.className = "shortcuts-reset-all";
  resetAll.textContent = "Reset all";
  resetAll.title = "Put every shortcut back to how it shipped";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button shortcuts-close";
  close.title = "Close";
  close.setAttribute("aria-label", "Close");
  close.append(createIcon(ICON.close));

  header.append(title, search, resetAll, close);

  const hint = document.createElement("p");
  hint.className = "shortcuts-hint";

  const list = document.createElement("div");
  list.className = "shortcuts-list";

  card.append(header, hint, list);
  dialog.append(card);
  host.append(dialog);

  /** The command currently capturing keys, or null. */
  let recording: string | null = null;

  close.addEventListener("click", () => api.close());
  search.addEventListener("input", () => draw());

  resetAll.addEventListener("click", () => {
    void deps.resetChord().then(() => {
      stopRecording();
      draw();
    });
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();

    // Escape leaves the recorder first. Otherwise the only way out of a row you opened by
    // accident is to bind something to it.
    if (recording !== null) {
      stopRecording();
      draw();
      return;
    }

    api.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) api.close();
  });

  /*
   * The capture handler, on the dialog, in the capture phase.
   *
   * Capture phase so it runs before anything else in the window sees the key - the whole
   * point is to take a chord away from whatever it currently does. Attached permanently
   * rather than added and removed around a recording, because a listener that is added on
   * click and removed on blur has two ways to leak and one to be missed.
   */
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (recording === null) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stopRecording();
        draw();
        return;
      }

      // Backspace clears the binding, which is the only way to say "this command should
      // have no shortcut" - and the only way to free a chord for something else.
      if (event.key === "Backspace" || event.key === "Delete") {
        const command = recording;
        stopRecording();
        void deps.setChord(command, null).then(() => draw());
        return;
      }

      /*
       * The chord is read by the shared module, not by this file.
       *
       * The recorder and the matcher have to agree about what a chord is down to the last
       * character - a recorder that wrote `Ctrl+P` where the matcher expects `CmdOrCtrl+P`
       * produces a binding that stores correctly, displays correctly, and never fires.
       */
      const chord = chordFromEvent(event);
      if (chord === null) return;

      if (!isBindableChord(chord)) {
        // Named rather than silent. A bare letter is refused for a good reason and the
        // reader is entitled to it, or they will simply try again and conclude it is broken.
        hint.dataset["tone"] = "warn";
        hint.textContent = `${formatChord(chord, deps.platform())} needs Ctrl, Alt, or to be a function key - a plain letter would fire while you type.`;
        return;
      }

      const command = recording;
      stopRecording();
      void deps.setChord(command, chord).then(() => draw());
    },
    true,
  );

  function stopRecording(): void {
    recording = null;
  }

  function setHint(): void {
    if (recording !== null) {
      hint.dataset["tone"] = "recording";
      hint.textContent = "Press the keys you want. Escape cancels, Backspace clears the shortcut.";
      return;
    }

    const collisions = conflicts(deps.bindings());

    if (collisions.size > 0) {
      const [chord, commands] = [...collisions][0] ?? ["", []];
      hint.dataset["tone"] = "warn";
      hint.textContent = `${formatChord(chord, deps.platform())} is claimed by ${commands.length} commands. Only the first will run.`;
      return;
    }

    hint.dataset["tone"] = "calm";
    hint.textContent = "Click a shortcut to change it. Backspace clears one.";
  }

  function draw(): void {
    setHint();
    list.replaceChildren();

    const needle = search.value.trim().toLowerCase();
    const bindings = deps.bindings();
    const collisions = conflicts(bindings);
    const platform = deps.platform();

    const matching = bindings.filter((binding) => {
      if (needle.length === 0) return true;

      const chord = binding.chord === null ? "" : formatChord(binding.chord, platform).toLowerCase();
      return (
        binding.title.toLowerCase().includes(needle) ||
        binding.group.toLowerCase().includes(needle) ||
        binding.command.toLowerCase().includes(needle) ||
        chord.includes(needle)
      );
    });

    if (matching.length === 0) {
      const empty = document.createElement("p");
      empty.className = "shortcuts-empty";
      empty.textContent = `Nothing matches "${search.value.trim()}".`;
      list.append(empty);
      return;
    }

    let lastGroup: string | null = null;

    for (const binding of matching) {
      if (binding.group !== lastGroup) {
        const heading = document.createElement("p");
        heading.className = "shortcuts-group";
        heading.textContent = binding.group;
        list.append(heading);
        lastGroup = binding.group;
      }

      list.append(row(binding, collisions, platform));
    }
  }

  function row(
    binding: Binding,
    collisions: ReadonlyMap<Chord, string[]>,
    platform: string,
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = "shortcuts-row";

    const name = document.createElement("span");
    name.className = "shortcuts-command";
    name.textContent = binding.title;
    element.append(name);

    const changed = binding.chord !== binding.defaultChord;
    if (changed) {
      const mark = document.createElement("span");
      mark.className = "shortcuts-changed";
      mark.textContent = "changed";
      mark.title =
        binding.defaultChord === null
          ? "This command shipped with no shortcut"
          : `Shipped as ${formatChord(binding.defaultChord, platform)}`;
      element.append(mark);
    }

    const key = document.createElement("button");
    key.type = "button";
    key.className = "shortcuts-key";
    key.dataset["state"] = recording === binding.command ? "recording" : "idle";

    if (binding.nativeRole) {
      /*
       * Shown, and refused, with the reason on the row.
       *
       * Copy and Paste have to reach the focused native control, which no message from
       * this window can do. Hiding them would be tidier and would leave the reader
       * wondering where Copy went - which is a worse question than the one this answers.
       */
      key.disabled = true;
      key.textContent = binding.chord === null ? "—" : formatChord(binding.chord, platform);
      key.title = "Handled by the system so it reaches the text box you are in. Cannot be changed.";
      key.dataset["native"] = "true";
    } else if (recording === binding.command) {
      key.textContent = "Press keys…";
    } else if (binding.chord === null) {
      key.textContent = "Not set";
      key.dataset["unset"] = "true";
    } else {
      key.textContent = formatChord(binding.chord, platform);
    }

    if (binding.chord !== null && collisions.has(binding.chord)) {
      key.dataset["conflict"] = "true";
      key.title = `Also bound to ${(collisions.get(binding.chord) ?? []).length - 1} other command. Only the first runs.`;
    }

    key.addEventListener("click", () => {
      if (binding.nativeRole) return;

      recording = recording === binding.command ? null : binding.command;
      draw();
    });

    element.append(key);

    // Only on a row that has been changed. A reset button on every row is forty controls
    // that do nothing, and the one that matters gets lost among them.
    if (changed) {
      const revert = document.createElement("button");
      revert.type = "button";
      revert.className = "icon-button shortcuts-revert";
      revert.title = "Put this shortcut back";
      revert.setAttribute("aria-label", `Reset the shortcut for ${binding.title}`);
      revert.append(createIcon(ICON.reload));

      revert.addEventListener("click", () => {
        stopRecording();
        void deps.resetChord(binding.command).then(() => draw());
      });

      element.append(revert);
    }

    return element;
  }

  const api: ShortcutsDialog = {
    open(): void {
      stopRecording();
      search.value = "";
      draw();

      dialog.showModal();
      search.focus();
    },

    close(): void {
      stopRecording();
      if (dialog.open) dialog.close();
    },

    isOpen: () => dialog.open,
    isRecording: () => recording !== null,

    refresh(): void {
      if (dialog.open) draw();
    },
  };

  return api;
}
