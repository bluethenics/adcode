/**
 * xterm host, wired to a real pty in the main process.
 *
 * Brief §6: WebGL renderer, true colour, ligatures. The WebGL addon is attempted and
 * falls back silently - a terminal that renders slightly slower is enormously better
 * than one that fails to open because a GPU driver misbehaved.
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { createCommandLineReader, detectAgent, type DetectedAgent } from "@adcode/ai/agents";
import type { ThemeChoice } from "../../shared/api.ts";

export interface TerminalHost {
  dispose(): void;
  fit(): void;
  focus(): void;
  /** Wipe the scrollback, as `clear` would. */
  clear(): void;
  /** Type a line into the shell and press return. */
  send(text: string): void;
  /** `adcode.ai.terminalAgentDetection`. */
  setAgentDetection(enabled: boolean): void;
  /** Paste the clipboard into the shell, as Ctrl+Shift+V does. */
  paste(): void;
  /** Copy the selection. Returns false when nothing is selected. */
  copy(): Promise<boolean>;
  applyTheme(theme: ThemeChoice): void;
}

/** macOS uses Cmd where everything else uses Ctrl, including for the clipboard. */
const platformIsMac = (): boolean => navigator.userAgent.includes("Mac");

/**
 * Pasted text, as a shell expects to receive it.
 *
 * Every newline becomes a carriage return, because carriage return is what a terminal means
 * by "the user pressed Enter". Sending a line feed instead leaves most shells waiting for
 * the rest of the line, so a pasted block of commands would sit there doing nothing.
 *
 * That does mean a multi-line paste runs every line, which is exactly what pasting a block
 * of commands is for - and what every other terminal does.
 */
function forShell(text: string): string {
  return text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

const THEMES = {
  dark: {
    background: "#1c1c1e",
    foreground: "#f5f5f7",
    cursor: "#0a84ff",
    selectionBackground: "#0a84ff44",
    black: "#1c1c1e",
    red: "#ff453a",
    green: "#30d158",
    yellow: "#ff9f0a",
    blue: "#0a84ff",
    magenta: "#bf5af2",
    cyan: "#64d2ff",
    white: "#f5f5f7",
  },
  light: {
    background: "#ffffff",
    foreground: "#1c1c1e",
    cursor: "#007aff",
    selectionBackground: "#007aff33",
    black: "#1c1c1e",
    red: "#ff3b30",
    green: "#34c759",
    yellow: "#ff9500",
    blue: "#007aff",
    magenta: "#af52de",
    cyan: "#5ac8fa",
    white: "#f2f2f7",
  },
  /*
   * Midnight. True black behind the shell, and a white cursor rather than a blue one -
   * this theme has no blue in it, and a systemBlue caret on a black terminal is the one
   * pixel that would give away that the palette was borrowed.
   *
   * The ANSI colours stay: they are what programs ask for by name, and a `git diff` that
   * printed grey instead of red would be this theme breaking other people's output.
   */
  midnight: {
    background: "#000000",
    foreground: "#f1f3f3",
    cursor: "#f1f3f3",
    selectionBackground: "#ffffff26",
    black: "#08090b",
    red: "#ff453a",
    green: "#30d158",
    yellow: "#ffb340",
    blue: "#0a84ff",
    magenta: "#bf5af2",
    cyan: "#64d2ff",
    white: "#f1f3f3",
  },
} as const;

export async function createTerminalHost(
  container: HTMLElement,
  options: {
    profileId?: string;
    cwd?: string;
    theme: ThemeChoice;
    /** Told when a command line starts a known AI agent (`adcode.ai.terminalAgentDetection`). */
    onAgent?: (agent: DetectedAgent) => void;
  },
): Promise<TerminalHost> {
  const terminal = new Terminal({
    fontFamily: '"SF Mono", "JetBrains Mono", "Cascadia Code", ui-monospace, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: "bar",
    allowProposedApi: true,
    scrollback: 10_000,
    theme: { ...THEMES[options.theme] },
  });

  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);

  try {
    terminal.loadAddon(new WebglAddon());
  } catch {
    // Canvas renderer is the fallback. Not worth failing the terminal over.
  }

  fit.fit();

  const id = await window.adcode.terminal.create({
    ...(options.profileId === undefined ? {} : { profileId: options.profileId }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    cols: terminal.cols,
    rows: terminal.rows,
  });

  const offData = window.adcode.terminal.onData((incomingId, data) => {
    if (incomingId === id) terminal.write(data);
  });

  const offExit = window.adcode.terminal.onExit((incomingId, exitCode) => {
    if (incomingId !== id) return;
    terminal.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
  });

  /*
   * What the user types, on its way to the shell.
   *
   * The keystrokes are already passing through here, so recognising `claude` costs one
   * string comparison per submitted line and no inspection of anything the user did not
   * type. The judgement is `@adcode/ai/agents`, which is pure and tested.
   */
  const commandLine = createCommandLineReader();
  let agentDetection = true;

  terminal.onData((data) => {
    window.adcode.terminal.write(id, data);

    if (!agentDetection || options.onAgent === undefined) return;

    const line = commandLine.push(data);
    if (line === null) return;

    const agent = detectAgent(line);
    if (agent !== null) options.onAgent(agent);
  });
  terminal.onResize(({ cols, rows }) => window.adcode.terminal.resize(id, cols, rows));

  /* ── Copy and paste ─────────────────────────────────────────────────── */

  /**
   * Send pasted text to the shell.
   *
   * Newlines become carriage returns because that is what a terminal means by "the user
   * pressed Enter"; sending `\n` leaves most shells waiting for the rest of the line. A
   * multi-line paste therefore runs, which is what pasting a block of commands is for.
   */
  async function paste(): Promise<void> {
    const text = await window.adcode.clipboard.readText();
    if (text.length === 0) return;

    window.adcode.terminal.write(id, forShell(text));
  }

  async function copySelection(): Promise<boolean> {
    const selection = terminal.getSelection();
    if (selection.length === 0) return false;

    await window.adcode.clipboard.writeText(selection);
    return true;
  }

  /*
   * Why this is a custom key handler rather than a keybinding.
   *
   * In a terminal, Ctrl+V and Ctrl+C are *control characters the shell wants* - Ctrl+C is
   * how you interrupt a running program, and taking it away would be worse than having no
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
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    const mod = platformIsMac() ? event.metaKey : event.ctrlKey;
    if (!mod) return true;

    const key = event.key.toLowerCase();

    if (key === "v") {
      void paste();
      return false;
    }

    if (key === "c") {
      // With no selection this has to fall through, or Ctrl+C stops interrupting.
      if (terminal.getSelection().length === 0) return true;
      void copySelection();
      return false;
    }

    return true;
  });

  // The second route in: a real paste event, which is what a middle-click and the Edit menu
  // produce. Without this, those do nothing at all.
  container.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text") ?? "";
    if (text.length === 0) return;

    window.adcode.terminal.write(id, forShell(text));
  });

  return {
    dispose() {
      offData();
      offExit();
      window.adcode.terminal.dispose(id);
      terminal.dispose();
    },
    fit() {
      try {
        fit.fit();
      } catch {
        // Fitting a hidden panel throws; it refits when shown.
      }
    },
    focus() {
      terminal.focus();
    },
    clear() {
      terminal.clear();
    },
    setAgentDetection(enabled) {
      agentDetection = enabled;
      if (!enabled) commandLine.reset();
    },
    paste() {
      void paste();
    },
    copy() {
      return copySelection();
    },
    send(text) {
      // Straight to the pty rather than into xterm: the shell is what should see the
      // keystrokes, and it echoes them back itself.
      window.adcode.terminal.write(id, `${text}
`);
    },
    applyTheme(theme) {
      terminal.options.theme = { ...THEMES[theme] };
    },
  };
}
