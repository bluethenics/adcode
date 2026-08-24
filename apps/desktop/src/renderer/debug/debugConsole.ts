/**
 * The Debug Console: ask the paused program a question.
 *
 * The floating debug card shows what the program's variables *are*. This answers the other
 * half of debugging, which is "what would this expression be?" - the question you cannot
 * answer by reading a variables list, because the thing you want is usually a comparison,
 * a property two levels down, or a call.
 *
 * **It evaluates in the selected frame, not always the top one.** The whole point of a call
 * stack is being able to look at a caller's scope, and a console that quietly evaluated
 * somewhere other than the frame you are looking at would give correct-looking answers to a
 * different question.
 *
 * **Nothing is evaluated unless the program is paused.** Not a limitation worth hiding: an
 * expression evaluated against a running program either races it or has no frame to run in,
 * so the input says so rather than failing per keystroke.
 */
import type { DebugEvaluationView, DebugStateView } from "../../shared/api.ts";

export interface DebugConsoleDeps {
  readonly evaluate: (frameId: string, expression: string) => Promise<DebugEvaluationView>;
}

export interface DebugConsole {
  readonly element: HTMLElement;
  /** Follow the debugger: which frame to evaluate in, and whether anything can be. */
  setState(state: DebugStateView): void;
  focus(): void;
}

/** Enough to get back to what you tried five minutes ago; small enough to never think about. */
const MAX_HISTORY = 100;

export function createDebugConsole(deps: DebugConsoleDeps): DebugConsole {
  const element = document.createElement("div");
  element.className = "debug-console";

  const transcript = document.createElement("div");
  transcript.className = "debug-console-transcript";
  transcript.tabIndex = 0;

  const form = document.createElement("form");
  form.className = "debug-console-form";

  const prompt = document.createElement("span");
  prompt.className = "debug-console-prompt";
  prompt.textContent = "›";
  prompt.ariaHidden = "true";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "debug-console-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.ariaLabel = "Expression to evaluate";

  form.append(prompt, input);
  element.append(transcript, form);

  const history: string[] = [];
  /** Where the up/down keys are in `history`. `history.length` means "the live input". */
  let cursor = 0;
  let frameId: string | null = null;
  let paused = false;

  function line(text: string, kind: "input" | "result" | "error" | "note"): void {
    const row = document.createElement("div");
    row.className = `debug-console-line debug-console-${kind}`;
    row.textContent = kind === "input" ? `› ${text}` : text;
    transcript.append(row);
    // Always follows: unlike a log, every line here is the direct answer to something the
    // user just typed, so there is no reading-while-it-writes case to protect.
    transcript.scrollTop = transcript.scrollHeight;
  }

  function setEnabled(): void {
    const ready = paused && frameId !== null;
    input.disabled = !ready;
    input.placeholder = ready
      ? "Evaluate an expression"
      : "Pause at a breakpoint to evaluate expressions";
  }

  async function submit(expression: string): Promise<void> {
    if (frameId === null) return;

    line(expression, "input");
    history.push(expression);
    if (history.length > MAX_HISTORY) history.shift();
    cursor = history.length;

    const result = await deps.evaluate(frameId, expression);
    line(result.value, result.error ? "error" : "result");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const expression = input.value.trim();
    if (expression === "") return;
    input.value = "";
    void submit(expression);
  });

  input.addEventListener("keydown", (event) => {
    // A console without history is a console you retype everything into.
    if (event.key === "ArrowUp") {
      if (cursor === 0) return;
      event.preventDefault();
      cursor -= 1;
      input.value = history[cursor] ?? "";
      return;
    }

    if (event.key === "ArrowDown") {
      if (cursor >= history.length) return;
      event.preventDefault();
      cursor += 1;
      input.value = cursor === history.length ? "" : (history[cursor] ?? "");
    }
  });

  setEnabled();

  return {
    element,

    setState(state) {
      const wasPaused = paused;
      paused = state.state === "paused";

      // Frames exist only on the paused variant, so the narrowing is the type talking:
      // there is genuinely no call stack while a program is running.
      const top = state.state === "paused" ? state.frames[0] : undefined;

      // The top frame by default. Once a frame is selected in the debug card this is where
      // that selection would be threaded in; until then, "where execution is" is the frame
      // people mean.
      frameId = top?.id ?? null;

      if (paused && !wasPaused) {
        line(top === undefined ? "Paused." : `Paused in ${top.name}.`, "note");
      } else if (!paused && wasPaused) {
        // Said out loud because the input greys out at the same moment, and an input that
        // stops accepting text with no explanation reads as a bug.
        line("Resumed - nothing to evaluate against.", "note");
      }

      setEnabled();
    },

    focus() {
      if (!input.disabled) input.focus();
      else transcript.focus();
    },
  };
}
