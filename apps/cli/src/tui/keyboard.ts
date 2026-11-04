/**
 * Raw keyboard input for the full-screen screens.
 *
 * This is a small parser rather than `readline.emitKeypressEvents` because the terminal
 * also sends events the keypress layer has no vocabulary for: focus reporting (which the
 * ad renderer needs in order to earn an honest impression), bracketed paste, and partial
 * escape sequences split across reads. Every exit path restores the terminal, and this
 * module never calls `process.exit`, so a caller can clean up its screen first.
 */

export interface Key {
  readonly name: string;
  readonly sequence: string;
  readonly string: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly paste?: boolean;
}

export interface KeyboardOptions {
  readonly onKey?: (key: Key) => void;
  readonly onResize?: () => void;
  readonly onFocus?: (focused: boolean) => void;
  /** stdin ended, as it does on ctrl+d in some terminals and on a closed pipe. */
  readonly onEnd?: () => void;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
}

const ESC = "\x1b";
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

const NAMED: Readonly<Record<string, string>> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "tab",
};

const TILDE: Readonly<Record<string, string>> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
};

function keyOf(name: string, sequence: string, text = "", options: Partial<Key> = {}): Key {
  return {
    name,
    sequence,
    string: text,
    ctrl: options.ctrl ?? false,
    meta: options.meta ?? false,
    shift: options.shift ?? false,
    ...(options.paste === true ? { paste: true } : {}),
  };
}

export function startKeyboard(options: KeyboardOptions = {}): () => void {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  if (stdin.isTTY !== true) return () => {};

  const previousRaw = stdin.isRaw === true;
  if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let stopped = false;
  let buffer = "";
  let escapedTimer: NodeJS.Timeout | null = null;

  const emit = (key: Key): void => {
    if (stopped) return;
    options.onKey?.(key);
  };

  const flushEscape = (): void => {
    escapedTimer = null;
    if (buffer === ESC) {
      buffer = "";
      emit(keyOf("escape", ESC));
      return;
    }
    if (buffer.startsWith(`${ESC}${ESC}`)) {
      buffer = buffer.slice(2);
      emit(keyOf("escape", ESC, "", { meta: true }));
      processBuffer();
      return;
    }
    if (buffer.startsWith(ESC) && buffer.length === 2) {
      const character = buffer.slice(1);
      buffer = "";
      emit(keyOf(character, ESC + character, character, { meta: true }));
    }
  };

  const processBuffer = (): void => {
    while (buffer.length > 0 && !stopped) {
      if (buffer.startsWith(PASTE_START)) {
        const end = buffer.indexOf(PASTE_END, PASTE_START.length);
        if (end === -1) return;
        const text = buffer.slice(PASTE_START.length, end);
        buffer = buffer.slice(end + PASTE_END.length);
        emit({ ...keyOf("paste", text, text), paste: true });
        continue;
      }

      if (buffer.startsWith(`${ESC}[`)) {
        const complete = buffer.match(/^\x1b\[([0-9;?]*)([A-Za-z~])/);
        if (complete === null) return;
        const body = complete[1] ?? "";
        const final = complete[2] ?? "";
        const sequence = complete[0];
        buffer = buffer.slice(sequence.length);

        if (final === "I") {
          options.onFocus?.(true);
          emit(keyOf("focus", sequence));
          continue;
        }
        if (final === "O") {
          options.onFocus?.(false);
          emit(keyOf("blur", sequence));
          continue;
        }
        if (final === "~") {
          const name = TILDE[body];
          if (name !== undefined) {
            emit(keyOf(name, sequence));
            continue;
          }
          // Modified keys arrive as `1;5A`-style sequences; keep the final letter.
          const last = body.split(";").pop() ?? "";
          if (last.length === 1 && NAMED[last] !== undefined) {
            const name = NAMED[last] ?? last;
            const modifier = Number.parseInt(body.split(";")[1] ?? "1", 10);
            emit(keyOf(name, sequence, "", { shift: modifier === 2, meta: modifier === 3 || modifier === 4, ctrl: modifier === 5 }));
          }
          continue;
        }
        if (final === "Z") {
          emit(keyOf("tab", sequence, "", { shift: true }));
          continue;
        }
        const name = NAMED[final];
        if (name !== undefined) {
          const modifier = body.length >= 2 ? Number.parseInt(body.split(";")[1] ?? "1", 10) : 1;
          if (body.includes(";")) {
            emit(keyOf(name, sequence, "", { shift: modifier === 2, meta: modifier === 3 || modifier === 4, ctrl: modifier === 5 }));
          } else {
            emit(keyOf(name, sequence));
          }
          continue;
        }
        continue;
      }

      if (buffer.startsWith(ESC)) {
        if (buffer.length === 1) {
          escapedTimer ??= setTimeout(flushEscape, 25);
          return;
        }
        // Alt + a printable character.
        const character = buffer[1] ?? "";
        buffer = buffer.slice(2);
        emit(keyOf(character, ESC + character, character, { meta: true }));
        continue;
      }

      const character = String.fromCodePoint(buffer.codePointAt(0) ?? 32);
      buffer = buffer.slice(character.length);
      const code = character.codePointAt(0) ?? 0;

      if (character === "\r" || character === "\n") {
        emit(keyOf("return", character, "\r"));
        continue;
      }
      if (character === "\t") {
        emit(keyOf("tab", character, "\t"));
        continue;
      }
      if (character === "\x7f" || character === "\b") {
        emit(keyOf("backspace", character));
        continue;
      }
      if (character === "\x00") {
        emit(keyOf("space", " ", " ", { ctrl: true }));
        continue;
      }
      if (code >= 1 && code <= 26) {
        const letter = String.fromCharCode(96 + code);
        emit(keyOf(letter, character, letter, { ctrl: true }));
        continue;
      }
      if (code === 27) {
        emit(keyOf("escape", ESC));
        continue;
      }
      if (character === " ") {
        emit(keyOf("space", " ", " "));
        continue;
      }
      if (code < 32) continue;

      emit(keyOf(character, character, character));
    }
  };

  const data = (chunk: string | Buffer): void => {
    if (typeof chunk !== "string") chunk = chunk.toString("utf8");
    if (escapedTimer !== null) {
      clearTimeout(escapedTimer);
      escapedTimer = null;
    }
    buffer += chunk;
    processBuffer();
  };

  const resize = (): void => options.onResize?.();

  let ended = false;
  const end = (): void => {
    if (stopped || ended) return;
    ended = true;
    options.onEnd?.();
  };

  stdin.on("data", data);
  stdin.on("end", end);
  stdin.on("close", end);
  stdout.on("resize", resize);

  return () => {
    if (stopped) return;
    stopped = true;
    if (escapedTimer !== null) clearTimeout(escapedTimer);
    escapedTimer = null;
    stdin.removeListener("data", data);
    stdin.removeListener("end", end);
    stdin.removeListener("close", end);
    stdout.removeListener("resize", resize);
    try {
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(previousRaw);
      stdin.pause();
    } catch {
      // A closed stdin is already restored as far as we are concerned.
    }
  };
}
