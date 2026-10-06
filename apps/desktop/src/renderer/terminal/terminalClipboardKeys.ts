/**
 * The terminal's clipboard keys, as one decision that can be tested without a terminal.
 *
 * In a terminal, Ctrl+V and Ctrl+C are *control characters the shell wants* - Ctrl+C is how
 * you interrupt a running program, and taking it away would be worse than having no
 * clipboard at all. So:
 *
 * - **Ctrl+Shift+V** always pastes. It is the terminal convention on Windows and Linux.
 * - **Ctrl+V** also pastes, because on Windows people expect it to and no shell reads
 *   Ctrl+V as anything meaningful.
 * - **Ctrl+Shift+C** copies the selection.
 * - **Ctrl+C** is left alone entirely unless there is a selection, and even then it only
 *   copies when something is actually selected - otherwise it interrupts, as it must.
 *
 * Returning `false` tells xterm not to also handle the key, which is what stops the
 * character reaching the pty as well.
 */

/** The parts of a keyboard event this reads. A real `KeyboardEvent` satisfies it. */
export interface ClipboardKeyEvent {
  readonly type: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface ClipboardKeyActions {
  /** macOS uses Cmd where everything else uses Ctrl, including for the clipboard. */
  readonly isMac: boolean;
  hasSelection(): boolean;
  paste(): void;
  copy(): void;
}

/** xterm's custom key handler: `true` lets xterm handle the key, `false` means it was handled here. */
export function handleClipboardKey(event: ClipboardKeyEvent, actions: ClipboardKeyActions): boolean {
  if (event.type !== "keydown") return true;

  const mod = actions.isMac ? event.metaKey : event.ctrlKey;
  if (!mod) return true;

  const key = event.key.toLowerCase();

  /*
   * A key taken here also cancels the browser's own action for it.
   *
   * Returning false stops xterm handling the key, but not the browser: Ctrl+V's default
   * action still fires a native paste event, which xterm pastes as well. The shell received
   * every paste twice - `cp .env.example .envcp .env.example .env` - until this.
   */
  if (key === "v") {
    event.preventDefault();
    actions.paste();
    return false;
  }

  if (key === "c") {
    // With no selection this has to fall through, or Ctrl+C stops interrupting.
    if (!actions.hasSelection()) return true;
    event.preventDefault();
    actions.copy();
    return false;
  }

  return true;
}
