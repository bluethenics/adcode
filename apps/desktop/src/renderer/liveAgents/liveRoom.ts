/**
 * The live room: every background agent at once, docked at the top of the chat.
 *
 * A strip of mascots - the team, side by side - over a grid of live windows, one per agent.
 * When one agent messages another, hands its work on, or runs into a teammate's file, the
 * sender turns to face the receiver, a small speech bubble crosses between them, the receiver
 * turns back and nods, and the line lands in the log. Every one of those is a real event
 * (`liveRoomModel.ts`); with reduced motion only the log line changes.
 *
 * Shown while any agent is on it; a finished agent stays a few seconds so its result can be
 * read, then the room tidies itself away.
 */
import type { MascotLook } from "../agents/mascotStyle.ts";
import type { AgentMascot } from "../agents/agentMascot.ts";
import { createAgentMascot } from "../agents/agentMascot.ts";
import { createFrameTask } from "../frameTask.ts";
import {
  addLiveSignal,
  applyLiveEvent,
  emptyLiveRoom,
  ensureLiveAgent,
  pruneLiveRoom,
  settleLiveGroup,
  takeLiveSignals,
  type LiveAgent,
  type LiveAgentIdentity,
  type LiveRoomEvent,
  type LiveRoomState,
  type LiveSignal,
} from "./liveRoomModel.ts";
import { createLiveWindow, reducedMotion, type LiveWindowHandle } from "./liveWindow.ts";

export interface LiveRoomOptions {
  lookFor(identity: LiveAgentIdentity): MascotLook;
  now?(): number;
}

export interface LiveRoomStats {
  readonly windows: number;
  readonly working: number;
  readonly typed: number;
  readonly animated: number;
  readonly log: string;
}

export interface LiveRoomHandle {
  readonly element: HTMLElement;
  apply(identity: LiveAgentIdentity, event: LiveRoomEvent): void;
  waiting(identity: LiveAgentIdentity, step: string): void;
  settle(group: string): void;
  signal(signal: Omit<LiveSignal, "id">): void;
  setEnabled(enabled: boolean): void;
  stats(): LiveRoomStats;
}

/** How long a finished agent's window stays up. */
const KEEP_FINISHED_MS = 12_000;
const BUBBLE_MS = 1_100;

interface Member {
  readonly element: HTMLButtonElement;
  readonly mascot: AgentMascot;
  readonly label: HTMLElement;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function createLiveRoom(options: LiveRoomOptions): LiveRoomHandle {
  const now = options.now ?? (() => Date.now());
  let state: LiveRoomState = emptyLiveRoom();
  let enabled = true;
  let collapsed = false;
  let expanded: string | null = null;
  let animated = 0;

  const element = make("section", "live-room");
  element.hidden = true;
  element.setAttribute("aria-label", "Agents working now");
  const head = make("header", "live-room-head");
  const pulse = make("span", "live-room-pulse");
  pulse.setAttribute("aria-hidden", "true");
  const title = make("span", "live-room-title", "Live agents");
  const count = make("span", "live-room-count");
  const toggle = make("button", "live-room-toggle", "Hide windows");
  toggle.type = "button";
  head.append(pulse, title, count, toggle);
  const strip = make("div", "live-room-strip");
  const log = make("p", "live-room-log");
  log.setAttribute("aria-live", "polite");
  const grid = make("div", "live-room-grid");
  element.append(head, strip, log, grid);

  const windows = new Map<string, LiveWindowHandle>();
  const members = new Map<string, Member>();

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    paint.schedule();
  });

  function labelOf(id: string): string {
    return state.agents.find((agent) => agent.id === id)?.label ?? "a teammate";
  }

  function describe(signal: LiveSignal): string {
    const to = signal.to.map(labelOf).join(", ") || "the team";
    if (signal.kind === "message") return `${labelOf(signal.from)} → ${to}: ${shorten(signal.text, 140)}`;
    if (signal.kind === "handoff") return `${labelOf(signal.from)} handed off to ${to}: ${shorten(signal.text, 120)}`;
    return `${labelOf(signal.from)} and ${to} both edited ${signal.text}`;
  }

  function memberFor(agent: LiveAgent): Member {
    let member = members.get(agent.id);
    if (member === undefined) {
      const button = make("button", "live-member");
      button.type = "button";
      const mascot = createAgentMascot({ look: options.lookFor(agent), mood: "thinking", size: 30 });
      const label = make("span", "live-member-label");
      button.append(mascot.element, label);
      button.addEventListener("click", () => {
        expanded = expanded === agent.id ? null : agent.id;
        collapsed = false;
        paint.schedule();
      });
      member = { element: button, mascot, label };
      members.set(agent.id, member);
    }
    return member;
  }

  function windowFor(agent: LiveAgent): LiveWindowHandle {
    let handle = windows.get(agent.id);
    if (handle === undefined) {
      handle = createLiveWindow({
        look: options.lookFor(agent),
        lines: 12,
        onBarClick: () => {
          expanded = expanded === agent.id ? null : agent.id;
          paint.schedule();
        },
      });
      windows.set(agent.id, handle);
    }
    return handle;
  }

  /* ── Signals: one at a time, so a burst reads as a conversation ─────── */

  const queue: LiveSignal[] = [];
  let playing = false;

  function centre(target: HTMLElement): { x: number; y: number } {
    const box = target.getBoundingClientRect();
    const frame = strip.getBoundingClientRect();
    return { x: box.left - frame.left + box.width / 2, y: box.top - frame.top + box.height * 0.3 };
  }

  async function play(signal: LiveSignal): Promise<void> {
    log.textContent = describe(signal);
    log.dataset["kind"] = signal.kind;
    log.classList.remove("is-fresh");
    void log.offsetWidth;
    log.classList.add("is-fresh");
    animated += 1;
    element.dataset["animated"] = String(animated);
    const from = members.get(signal.from);
    const targets = signal.to.map((id) => members.get(id)).filter((member): member is Member => member !== undefined).slice(0, 3);
    if (from === undefined || targets.length === 0 || reducedMotion() || element.hidden || document.hidden) return;

    for (const target of targets) {
      const a = centre(from.element);
      const b = centre(target.element);
      from.mascot.setGaze(b.x >= a.x ? "right" : "left");
      target.mascot.setGaze(a.x >= b.x ? "right" : "left");
      from.element.dataset["speaking"] = "true";
      const bubble = make("span", "live-bubble", signal.kind === "overlap" ? `⚠ ${shorten(signal.text, 22)}` : shorten(signal.text, 26));
      bubble.dataset["kind"] = signal.kind;
      bubble.setAttribute("aria-hidden", "true");
      strip.append(bubble);
      const lift = Math.min(18, Math.abs(b.x - a.x) / 6 + 8);
      const animation = bubble.animate(
        [
          { transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -100%) scale(0.4)`, opacity: 0 },
          { transform: `translate(${a.x}px, ${a.y - 6}px) translate(-50%, -100%) scale(1)`, opacity: 1, offset: 0.18 },
          { transform: `translate(${(a.x + b.x) / 2}px, ${Math.min(a.y, b.y) - lift}px) translate(-50%, -100%) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${b.x}px, ${b.y - 4}px) translate(-50%, -100%) scale(0.85)`, opacity: 1, offset: 0.88 },
          { transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -100%) scale(0.5)`, opacity: 0 },
        ],
        { duration: BUBBLE_MS, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" },
      );
      try {
        await animation.finished;
      } catch {
        // Cancelled by a removal: nothing to finish.
      }
      bubble.remove();
      delete from.element.dataset["speaking"];
      target.mascot.nod();
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    from.mascot.setGaze("ahead");
    for (const target of targets) target.mascot.setGaze("ahead");
  }

  async function pump(): Promise<void> {
    if (playing) return;
    playing = true;
    try {
      while (queue.length > 0) await play(queue.shift()!);
    } finally {
      playing = false;
    }
  }

  /* ── Painting ─────────────────────────────────────────────────────────── */

  let ticker: number | null = null;

  const paint = createFrameTask(() => {
    const at = now();
    state = pruneLiveRoom(state, at, KEEP_FINISHED_MS);
    const visible = enabled && state.agents.length > 0;
    element.hidden = !visible;
    const working = state.agents.filter((agent) => agent.status === "working").length;
    const waiting = state.agents.filter((agent) => agent.status === "waiting").length;
    count.textContent = working > 0
      ? `${working} working${waiting > 0 ? ` · ${waiting} waiting` : ""}`
      : waiting > 0 ? `${waiting} waiting` : "All finished";
    element.dataset["working"] = String(working);
    pulse.dataset["live"] = working > 0 ? "true" : "false";
    toggle.textContent = collapsed ? "Show windows" : "Hide windows";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    grid.hidden = collapsed;
    if (expanded !== null && !state.agents.some((agent) => agent.id === expanded)) expanded = null;
    element.toggleAttribute("data-expanded", expanded !== null);
    grid.dataset["count"] = String(Math.min(state.agents.length, 4));

    const ids = new Set(state.agents.map((agent) => agent.id));
    for (const [id, handle] of windows) {
      if (!ids.has(id)) {
        handle.destroy();
        windows.delete(id);
      }
    }
    for (const [id, member] of members) {
      if (!ids.has(id)) {
        member.element.remove();
        members.delete(id);
      }
    }
    state.agents.forEach((agent, index) => {
      const member = memberFor(agent);
      member.label.textContent = agent.label;
      member.element.dataset["status"] = agent.status;
      member.element.setAttribute("aria-pressed", String(expanded === agent.id));
      member.element.title = `${agent.label}: ${agent.step}`;
      member.mascot.setMood(agent.status === "waiting" ? "sleepy" : agent.status === "failed" ? "confused" : agent.status === "done" ? "happy" : "thinking");
      if (strip.children[index] !== member.element) strip.insertBefore(member.element, strip.children[index] ?? null);

      const handle = windowFor(agent);
      handle.update(agent, at);
      handle.element.toggleAttribute("data-expanded", expanded === agent.id);
      if (grid.children[index] !== handle.element) grid.insertBefore(handle.element, grid.children[index] ?? null);
    });
    element.dataset["windows"] = String(windows.size);

    const [drained, signals] = takeLiveSignals(state);
    state = drained;
    if (signals.length > 0) {
      queue.push(...signals);
      queue.splice(0, Math.max(0, queue.length - 6));
      void pump();
    }

    // A clock for the elapsed times, only while something is on screen.
    if (visible && ticker === null) ticker = window.setInterval(() => paint.schedule(), 1_000);
    if (!visible && ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  });

  return {
    element,
    apply(identity, event) {
      state = applyLiveEvent(state, identity, event, now());
      paint.schedule();
    },
    waiting(identity, step) {
      state = ensureLiveAgent(state, identity, step, now());
      paint.schedule();
    },
    settle(group) {
      state = settleLiveGroup(state, group);
      paint.schedule();
    },
    signal(signal) {
      state = addLiveSignal(state, signal);
      paint.schedule();
    },
    setEnabled(on) {
      enabled = on;
      paint.schedule();
    },
    stats() {
      let typed = 0;
      for (const handle of windows.values()) typed += handle.typed();
      return {
        windows: windows.size,
        working: state.agents.filter((agent) => agent.status === "working").length,
        typed,
        animated,
        log: log.textContent ?? "",
      };
    },
  };
}
