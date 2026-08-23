/**
 * The debugger's face: where the program is, and what everything is worth.
 *
 * A floating card rather than a docked panel, for the same reason §5.3 gives for the chat
 * widget: a panel forces a layout decision on every session, and a debug session is not
 * every session. It appears when a program stops and gets out of the way when it does not.
 *
 * The card shows what a paused program is actually asked about, in the order it is asked:
 * the controls, then where it stopped, then what the values are. Variables are fetched when
 * a scope is opened rather than up front - a global scope is thousands of entries and
 * nobody has ever wanted all of them.
 */
import type {
  BreakpointView,
  DebugScopeView,
  DebugStateView,
  DebugVariableView,
} from "../../shared/api.ts";

export interface DebugView {
  readonly element: HTMLElement;
  render(state: DebugStateView): void;
  isOpen(): boolean;
  close(): void;
}

export interface DebugViewDeps {
  readonly host: HTMLElement;
  readonly resume: () => void;
  readonly stepOver: () => void;
  readonly stepInto: () => void;
  readonly stepOut: () => void;
  readonly stop: () => void;
  readonly scopes: (frameId: string) => Promise<readonly DebugScopeView[]>;
  readonly properties: (objectId: string) => Promise<readonly DebugVariableView[]>;
  /** Open a file at a line, for clicking a stack frame. */
  readonly openAt: (path: string, line: number) => void;
  readonly displayPath: (path: string) => string;
}

/** What the header says, per state. */
const LABELS: Readonly<Record<string, string>> = {
  idle: "Not running",
  starting: "Starting…",
  running: "Running",
  paused: "Paused",
  stopped: "Finished",
  failed: "Could not start",
};

const REASONS: Readonly<Record<string, string>> = {
  breakpoint: "at a breakpoint",
  step: "after a step",
  exception: "on an exception",
  entry: "at the first line",
  pause: "because you paused it",
  other: "",
};

export function createDebugView(deps: DebugViewDeps): DebugView {
  const card = document.createElement("section");
  card.className = "debug-card";
  card.hidden = true;
  card.setAttribute("role", "complementary");
  card.setAttribute("aria-label", "Debugger");

  const header = document.createElement("header");
  header.className = "debug-header";

  const title = document.createElement("span");
  title.className = "debug-title";

  const controls = document.createElement("div");
  controls.className = "debug-controls";

  function control(label: string, hint: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "debug-control";
    button.textContent = label;
    button.title = hint;
    button.addEventListener("click", onClick);
    return button;
  }

  const resumeButton = control("Continue", "Continue (F5)", deps.resume);
  const overButton = control("Step over", "Step over (F10)", deps.stepOver);
  const intoButton = control("Step into", "Step into (F11)", deps.stepInto);
  const outButton = control("Step out", "Step out (Shift+F11)", deps.stepOut);
  const stopButton = control("Stop", "Stop debugging (Shift+F5)", deps.stop);

  controls.append(resumeButton, overButton, intoButton, outButton, stopButton);
  header.append(title, controls);

  const body = document.createElement("div");
  body.className = "debug-body";

  const stack = document.createElement("div");
  stack.className = "debug-stack";

  const variables = document.createElement("div");
  variables.className = "debug-variables";

  body.append(stack, variables);
  card.append(header, body);
  deps.host.append(card);

  /** The frame whose scopes are on screen, so re-rendering does not reset the selection. */
  let selectedFrame: string | null = null;

  async function showScopes(frameId: string): Promise<void> {
    selectedFrame = frameId;
    variables.replaceChildren();

    const scopes = await deps.scopes(frameId);

    for (const scope of scopes) {
      const group = document.createElement("details");
      group.className = "debug-scope";
      // Local first and open; everything outside it is noise until asked for.
      group.open = scope.kind === "local";

      const summary = document.createElement("summary");
      summary.textContent = scope.name;
      group.append(summary);

      const list = document.createElement("div");
      list.className = "debug-scope-list";
      group.append(list);

      let loaded = false;
      const fill = async (): Promise<void> => {
        if (loaded || scope.objectId === null) return;
        loaded = true;

        const rows = await deps.properties(scope.objectId);
        list.replaceChildren();
        for (const row of rows) list.append(variableRow(row));
      };

      group.addEventListener("toggle", () => {
        if (group.open) void fill();
      });
      if (group.open) void fill();

      variables.append(group);
    }
  }

  /** One value, expandable when there is something inside it. */
  function variableRow(variable: DebugVariableView): HTMLElement {
    if (variable.objectId === undefined) {
      const row = document.createElement("div");
      row.className = "debug-variable";

      const name = document.createElement("span");
      name.className = "debug-variable-name";
      name.textContent = variable.name;

      const value = document.createElement("span");
      value.className = "debug-variable-value";
      value.dataset["type"] = variable.type;
      value.textContent = variable.value;

      row.append(name, value);
      return row;
    }

    const group = document.createElement("details");
    group.className = "debug-variable-group";

    const summary = document.createElement("summary");
    summary.innerHTML = "";
    const name = document.createElement("span");
    name.className = "debug-variable-name";
    name.textContent = variable.name;
    const value = document.createElement("span");
    value.className = "debug-variable-value";
    value.textContent = variable.value;
    summary.append(name, value);
    group.append(summary);

    const list = document.createElement("div");
    list.className = "debug-scope-list";
    group.append(list);

    let loaded = false;
    group.addEventListener("toggle", () => {
      if (!group.open || loaded || variable.objectId === undefined) return;
      loaded = true;

      void deps.properties(variable.objectId).then((rows) => {
        list.replaceChildren();
        for (const row of rows) list.append(variableRow(row));
      });
    });

    return group;
  }

  function renderStack(state: DebugStateView): void {
    stack.replaceChildren();
    if (state.state !== "paused") return;

    for (const [index, frame] of state.frames.entries()) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "debug-frame";
      row.dataset["selected"] = String(frame.id === selectedFrame || (selectedFrame === null && index === 0));

      const name = document.createElement("span");
      name.className = "debug-frame-name";
      name.textContent = frame.name;

      const where = document.createElement("span");
      where.className = "debug-frame-where";
      where.textContent =
        frame.path === null ? "internal" : `${deps.displayPath(frame.path)}:${String(frame.line)}`;

      row.append(name, where);
      row.addEventListener("click", () => {
        selectedFrame = frame.id;
        renderStack(state);
        void showScopes(frame.id);
        if (frame.path !== null) deps.openAt(frame.path, frame.line);
      });

      stack.append(row);
    }
  }

  return {
    element: card,

    render(state: DebugStateView): void {
      // Visible for everything except "not running at all" - including `stopped` and
      // `failed`, which are the two states somebody most wants to read.
      card.hidden = state.state === "idle";

      const detail =
        state.state === "paused"
          ? ` ${REASONS[state.reason] ?? ""}`
          : state.state === "failed"
            ? ` — ${state.message}`
            : state.state === "stopped" && state.exitCode !== null
              ? ` — exit code ${String(state.exitCode)}`
              : "";

      title.textContent = `${LABELS[state.state] ?? state.state}${detail}`;
      card.dataset["state"] = state.state;

      // Stepping a program that is running does nothing, and a button that does nothing is
      // worse than one that is visibly unavailable.
      const paused = state.state === "paused";
      for (const button of [overButton, intoButton, outButton]) button.disabled = !paused;
      resumeButton.disabled = !paused;
      stopButton.disabled = state.state === "idle" || state.state === "stopped";

      if (state.state === "paused") {
        const first = state.frames[0];
        if (selectedFrame === null && first !== undefined) selectedFrame = first.id;
        renderStack(state);
        if (selectedFrame !== null) void showScopes(selectedFrame);
      } else {
        selectedFrame = null;
        stack.replaceChildren();
        variables.replaceChildren();
      }
    },

    isOpen: () => !card.hidden,

    close(): void {
      card.hidden = true;
    },
  };
}

/** Breakpoints for one file, which is what the gutter draws. */
export const breakpointsFor = (all: readonly BreakpointView[], path: string): BreakpointView[] =>
  all.filter((point) => point.path === path);
