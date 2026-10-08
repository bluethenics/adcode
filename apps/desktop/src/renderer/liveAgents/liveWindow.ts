/**
 * One agent's live window: a small app window showing what that agent is doing right now.
 *
 * Drawn like the floating Preview - a title bar with three dots - because it is the same
 * idea: a view into something running. Inside, whatever the agent is doing: code being typed
 * into a file, a command and its output, its plan while it thinks, or its reply. Underneath,
 * the files it has touched, how long it has worked, and whether it has proved its work.
 *
 * The code types in at a pace (`typingPace.ts`) rather than in bursts. Only the newest lines
 * are kept in the DOM: a window shows what is being written now, the file itself is a click
 * away in the editor.
 */
import { createAgentMascot, type AgentMascot, type AgentMood } from "../agents/agentMascot.ts";
import type { MascotLook } from "../agents/mascotStyle.ts";
import { tintLine } from "./codeTint.ts";
import { formatLiveDuration, type LiveAgent } from "./liveRoomModel.ts";
import { createTypingPace } from "./typingPace.ts";

export interface LiveWindowHandle {
  readonly element: HTMLElement;
  readonly mascot: AgentMascot;
  update(agent: LiveAgent, now: number): void;
  /** Characters of code shown so far in this window, across every file it has written. */
  typed(): number;
  destroy(): void;
}

export interface LiveWindowOptions {
  readonly look: MascotLook;
  /** Lines of code kept on screen. */
  readonly lines?: number;
  onBarClick?(): void;
}

const MOOD: Readonly<Record<LiveAgent["status"], AgentMood>> = {
  waiting: "sleepy",
  working: "thinking",
  done: "happy",
  failed: "confused",
};

const STATUS_TEXT: Readonly<Record<LiveAgent["status"], string>> = {
  waiting: "Waiting",
  working: "Live",
  done: "Done",
  failed: "Stopped",
};

const PROOF_TEXT = { passed: "Checks passed", failed: "Check failed", unverified: "Unverified" } as const;

export function reducedMotion(): boolean {
  return document.documentElement.dataset["reducedMotion"] === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

export function createLiveWindow(options: LiveWindowOptions): LiveWindowHandle {
  const visibleLines = options.lines ?? 14;
  const element = make("section", "live-window");
  element.setAttribute("aria-label", "Agent at work");

  const bar = make("header", "live-window-bar");
  const dots = make("span", "live-window-dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(make("i", ""), make("i", ""), make("i", ""));
  const mascot = createAgentMascot({ look: options.look, mood: "thinking", size: 20 });
  const title = make("span", "live-window-title");
  const name = make("b", "live-window-name");
  const model = make("span", "live-window-model");
  title.append(name, model);
  const status = make("span", "live-window-status");
  bar.append(dots, mascot.element, title, status);
  if (options.onBarClick !== undefined) {
    bar.tabIndex = 0;
    bar.setAttribute("role", "button");
    bar.addEventListener("click", () => options.onBarClick?.());
    bar.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        options.onBarClick?.();
      }
    });
  }

  const step = make("div", "live-window-step");
  const body = make("div", "live-window-body");
  const footer = make("footer", "live-window-foot");
  const files = make("span", "live-window-files");
  const proof = make("span", "live-window-proof");
  const elapsed = make("span", "live-window-elapsed");
  footer.append(files, proof, elapsed);
  element.append(bar, step, body, footer);

  // Code view, built once and refilled.
  const code = make("div", "live-code");
  // Typed a character at a time, inside the transcript's live region: a screen reader would
  // read every keystroke. The step line and the footer say what it wrote.
  code.setAttribute("aria-hidden", "true");
  const codeTab = make("div", "live-code-tab");
  const codeLines = make("pre", "live-code-lines");
  code.append(codeTab, codeLines);
  // Terminal view.
  const terminal = make("pre", "live-terminal");
  // Thinking / plan / reply view.
  const note = make("div", "live-note");

  let current: LiveAgent | null = null;
  let codeKey = "";
  let target = "";
  let shown = 0;
  let typedTotal = 0;
  let pace = createTypingPace();
  let frame: number | null = null;
  let lastFrame = 0;

  function paintCode(final: boolean): void {
    const text = target.slice(0, shown);
    const lines = text.split("\n");
    const first = Math.max(0, lines.length - visibleLines);
    const rows: HTMLElement[] = [];
    for (let index = first; index < lines.length; index += 1) {
      const row = make("span", "live-code-row");
      const number = make("span", "live-code-number", String(index + 1));
      const content = make("span", "live-code-text");
      for (const token of tintLine(lines[index]!)) {
        if (token.tone === "plain") content.append(token.text);
        else content.append(make("span", `live-tone-${token.tone}`, token.text));
      }
      if (index === lines.length - 1 && !final) content.append(make("span", "live-caret"));
      row.append(number, content);
      rows.push(row);
    }
    codeLines.replaceChildren(...rows);
  }

  function tick(time: number): void {
    frame = null;
    const dt = lastFrame === 0 ? 16 : Math.min(100, time - lastFrame);
    lastFrame = time;
    const count = pace.next(shown, target.length, dt);
    shown += count;
    typedTotal += count;
    const activity = current?.activity;
    paintCode(activity?.kind === "code" && activity.final && shown >= target.length);
    if (shown < target.length) frame = window.requestAnimationFrame(tick);
    else lastFrame = 0;
  }

  function typeTowards(text: string, final: boolean): void {
    if (text.length < shown) shown = text.length;
    target = text;
    if (reducedMotion() || document.hidden) {
      typedTotal += Math.max(0, text.length - shown);
      shown = text.length;
      paintCode(final);
      return;
    }
    if (shown >= target.length) {
      paintCode(final);
      return;
    }
    frame ??= window.requestAnimationFrame(tick);
  }

  function showBody(view: HTMLElement): void {
    if (body.firstElementChild !== view || body.childElementCount !== 1) body.replaceChildren(view);
  }

  function planList(agent: LiveAgent): HTMLElement | null {
    if (agent.plan.length === 0) return null;
    const list = make("ol", "live-plan");
    for (const item of agent.plan) {
      const row = make("li", "live-plan-step", item.step);
      row.dataset["status"] = item.status;
      list.append(row);
    }
    return list;
  }

  return {
    element,
    mascot,
    update(agent, now) {
      current = agent;
      element.dataset["status"] = agent.status;
      element.dataset["activity"] = agent.activity.kind;
      name.textContent = agent.label;
      model.textContent = agent.model;
      model.hidden = agent.model.length === 0;
      status.textContent = STATUS_TEXT[agent.status];
      status.dataset["status"] = agent.status;
      mascot.setMood(agent.status === "done" && agent.proof === "passed" ? "proud" : MOOD[agent.status]);
      step.textContent = agent.step;

      const activity = agent.activity;
      if (activity.kind === "code") {
        const key = `${activity.toolId}`;
        if (key !== codeKey) {
          codeKey = key;
          shown = 0;
          pace = createTypingPace();
        }
        codeTab.textContent = activity.path === null ? "Untitled" : baseName(activity.path);
        codeTab.title = activity.path ?? "";
        showBody(code);
        typeTowards(activity.text, activity.final);
      } else if (activity.kind === "command") {
        const lines = activity.output.split("\n");
        const tail = lines.slice(-Math.max(6, visibleLines - 1)).join("\n");
        terminal.replaceChildren(make("span", "live-terminal-prompt", "❯ "), activity.command, "\n", tail);
        if (!activity.final && agent.status === "working") terminal.append(make("span", "live-caret"));
        showBody(terminal);
      } else {
        const parts: HTMLElement[] = [];
        if (activity.kind === "thinking") parts.push(make("p", "live-thinking", "Thinking"));
        if (activity.kind === "text") parts.push(make("p", "live-reply", activity.text.trim()));
        if (activity.kind === "idle") parts.push(make("p", "live-idle", agent.status === "waiting" ? "Waiting for its turn" : "Getting ready"));
        const plan = planList(agent);
        if (plan !== null) parts.push(plan);
        note.replaceChildren(...parts);
        showBody(note);
      }

      const added = agent.files.reduce((sum, file) => sum + file.added, 0);
      const removed = agent.files.reduce((sum, file) => sum + file.removed, 0);
      files.textContent = agent.files.length === 0
        ? "No files yet"
        : `${agent.files.length} ${agent.files.length === 1 ? "file" : "files"} · +${added} −${removed}`;
      files.title = agent.files.map((file) => file.path).join("\n");
      proof.textContent = PROOF_TEXT[agent.proof];
      proof.dataset["proof"] = agent.proof;
      proof.hidden = agent.status === "waiting";
      elapsed.textContent = agent.status === "waiting" ? "" : formatLiveDuration((agent.endedAt ?? now) - agent.startedAt);
    },
    typed: () => typedTotal,
    destroy() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      element.remove();
    },
  };
}
