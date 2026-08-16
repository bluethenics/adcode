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

export interface TerminalHost {
  dispose(): void;
  fit(): void;
  focus(): void;
  /** Wipe the scrollback, as `clear` would. */
  clear(): void;
  /** Type a line into the shell and press return. */
  send(text: string): void;
  applyTheme(theme: "light" | "dark"): void;
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
} as const;

export async function createTerminalHost(
  container: HTMLElement,
  options: { profileId?: string; cwd?: string; theme: "light" | "dark" },
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

  terminal.onData((data) => window.adcode.terminal.write(id, data));
  terminal.onResize(({ cols, rows }) => window.adcode.terminal.resize(id, cols, rows));

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
    send(text) {
      // Straight to the pty rather than into xterm: the shell is what should see the
      // keystrokes, and it echoes them back itself.
      window.adcode.terminal.write(id, `${text}`);
    },
    applyTheme(theme) {
      terminal.options.theme = { ...THEMES[theme] };
    },
  };
}
