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

/** Stopping an agent. `run` may answer false: the user was asked and kept it going. */
export interface LiveStopAction {
  readonly label: string;
  run(): void | Promise<boolean | void>;
}

export interface LiveWindowOptions {
  readonly look: MascotLook;
  /** Lines of code kept on screen. */
  readonly lines?: number;
  onBarClick?(): void;
  /**
   * How to stop this agent, or null when it cannot be stopped from here. Asked on every
   * update, because an agent that has finished has nothing left to stop.
   */
  stop?(agent: LiveAgent): LiveStopAction | null;
  /** Open this agent's actions, anchored to the button that asked. */
  onMenu?(agent: LiveAgent, anchor: HTMLElement): void;
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
  // The controls live in the title bar, where a window's controls always are. Clicks on
  // them are theirs: the bar's own click (expand) never fires underneath.
  const controls = make("span", "live-window-controls");
  const stopButton = make("button", "live-window-stop");
  stopButton.type = "button";
  stopButton.hidden = true;
  const stopIcon = make("span", "live-window-stop-icon");
  stopIcon.setAttribute("aria-hidden", "true");
  const stopLabel = make("span", "live-window-stop-label", "Stop");
  stopButton.append(stopIcon, stopLabel);
  const menuButton = make("button", "live-window-menu", "⋯");
  menuButton.type = "button";
  menuButton.hidden = options.onMenu === undefined;
  menuButton.setAttribute("aria-haspopup", "menu");
  for (const control of [stopButton, menuButton]) {
    control.addEventListener("click", (event) => event.stopPropagation());
    control.addEventListener("keydown", (event) => event.stopPropagation());
  }
  let stopAction: LiveStopAction | null = null;
  stopButton.addEventListener("click", () => {
    const action = stopAction;
    if (action === null) return;
    stopButton.disabled = true;
    stopLabel.textContent = "Stopping";
    void Promise.resolve(action.run()).then((stopped) => {
      if (stopped !== false) return;
      stopButton.disabled = false;
      stopLabel.textContent = action.label;
    });
  });
  menuButton.addEventListener("click", () => {
    if (current !== null) options.onMenu?.(current, menuButton);
  });
  controls.append(stopButton, menuButton);
  bar.append(dots, mascot.element, title, status, controls);
  if (options.onBarClick !== undefined) {
    // The whole bar takes a click, but only the title is the keyboard's button: a button
    // may not hold other buttons, and Stop and ⋯ sit in the same bar.
    bar.dataset["expandable"] = "true";
    title.tabIndex = 0;
    title.setAttribute("role", "button");
    title.setAttribute("aria-label", "Expand or restore this window");
    bar.addEventListener("click", () => options.onBarClick?.());
    title.addEventListener("keydown", (event) => {
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
  // A reply types in the way code does, so you watch the agent write it.
  const reply = make("p", "live-reply");
  let replyTarget = "";
  let replyShown = 0;
  let replyPace = createTypingPace();
  let replyFrame: number | null = null;
  let replyLast = 0;
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

  function paintReply(): void {
    const writing = current?.status === "working" && current.activity.kind === "text";
    reply.replaceChildren(replyTarget.slice(0, replyShown));
    if (writing || replyShown < replyTarget.length) reply.append(make("span", "live-caret"));
  }

  function replyTick(time: number): void {
    replyFrame = null;
    const dt = replyLast === 0 ? 16 : Math.min(100, time - replyLast);
    replyLast = time;
    replyShown += replyPace.next(replyShown, replyTarget.length, dt);
    paintReply();
    if (replyShown < replyTarget.length) replyFrame = window.requestAnimationFrame(replyTick);
    else replyLast = 0;
  }

  /**
   * Move the reply towards `text`. The model keeps only a reply's tail, so when the start
   * moves on, what was already on screen is found again in the new text rather than typed
   * a second time.
   */
  function typeReply(text: string): void {
    if (!text.startsWith(replyTarget.slice(0, replyShown))) {
      // At least as long as before: the same reply, its start trimmed. Shorter: a new one.
      const shifted = replyTarget.length > 0 && text.length >= replyTarget.length;
      replyShown = shifted ? Math.max(0, text.length - (replyTarget.length - replyShown)) : 0;
      replyPace = createTypingPace();
    }
    replyTarget = text;
    if (reducedMotion() || document.hidden) replyShown = text.length;
    if (replyShown >= replyTarget.length) {
      paintReply();
      return;
    }
    replyFrame ??= window.requestAnimationFrame(replyTick);
    paintReply();
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
      status.textContent = agent.status === "working" && agent.activity.kind === "text" ? "Typing" : STATUS_TEXT[agent.status];
      status.dataset["status"] = agent.status;
      const live = agent.status === "working" || agent.status === "waiting";
      stopAction = live ? options.stop?.(agent) ?? null : null;
      stopButton.hidden = stopAction === null;
      if (stopAction !== null && !stopButton.disabled) {
        stopLabel.textContent = stopAction.label;
        stopButton.title = `${stopAction.label}: ${agent.label}`;
        stopButton.setAttribute("aria-label", `${stopAction.label} ${agent.label}`);
      }
      if (!live) {
        stopButton.disabled = false;
        stopLabel.textContent = "Stop";
      }
      menuButton.title = `Actions for ${agent.label}`;
      menuButton.setAttribute("aria-label", menuButton.title);
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
        if (activity.kind === "text") {
          typeReply(activity.text.trim());
          parts.push(reply);
        }
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
      if (replyFrame !== null) window.cancelAnimationFrame(replyFrame);
      frame = null;
      replyFrame = null;
      element.remove();
    },
  };
}
