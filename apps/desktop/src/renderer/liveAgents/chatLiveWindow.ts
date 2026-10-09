/**
 * The chat assistant's own live window, in the conversation where its work happens.
 *
 * The assistant already streams everything to the chat; this turns the parts worth watching
 * - code being written, a command running - into one window per turn, placed in the
 * transcript the first time there is something to watch, and updated in place after that
 * (the same rule as the plan card: one per turn, never a stack). When the turn ends the
 * window settles: the last code stays readable, with the files and checks underneath.
 */
import type { MascotLook } from "../agents/mascotStyle.ts";
import { createFrameTask } from "../frameTask.ts";
import { liveEventFrom, type LiveAgentEventLike } from "../../shared/liveAgents.ts";
import { applyLiveEvent, emptyLiveRoom, type LiveAgent, type LiveAgentIdentity, type LiveRoomState } from "./liveRoomModel.ts";
import { createLiveWindow, type LiveWindowHandle } from "./liveWindow.ts";

export interface ChatLiveWindow {
  /**
   * Feed one chat event. Returns the window's element the first time there is something to
   * watch, for the chat to place in its transcript; null otherwise.
   */
  handle(event: { readonly kind: string; readonly [key: string]: unknown }): HTMLElement | null;
  /** A new turn: the next thing worth watching gets a new window. */
  reset(): void;
  /** The turn ended. */
  finish(ok: boolean): void;
  /** Characters typed in this turn's window, for checks. */
  typed(): number;
}

export interface ChatLiveWindowOptions {
  /** Read when a window opens, so a look changed in Settings shows on the next one. */
  look(): MascotLook;
  label(): string;
  model(): string;
  enabled(): boolean;
  /** Stop the turn, the same as the chat's stop button. */
  stop?(): void;
  onMenu?(agent: LiveAgent, anchor: HTMLElement): void;
}

const WATCHED_TOOLS = new Set(["edit_file", "propose_edit", "run_command"]);

export function createChatLiveWindow(options: ChatLiveWindowOptions): ChatLiveWindow {
  let state: LiveRoomState = emptyLiveRoom();
  let window_: LiveWindowHandle | null = null;
  let ticker: number | null = null;
  let typedBefore = 0;

  const identity = (): LiveAgentIdentity => ({ id: "chat", label: options.label(), role: "assistant", model: options.model(), lookKey: "chat", group: "chat" });

  const paint = createFrameTask(() => {
    const agent = state.agents[0];
    if (agent !== undefined && window_ !== null) window_.update(agent, Date.now());
  });

  function stopTicker(): void {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
  }

  return {
    handle(event) {
      const live = liveEventFrom(event as LiveAgentEventLike);
      // The chat prints the assistant's words itself; the window keeps showing its work.
      if (live === null || live.kind === "text") return null;
      if (state.agents.length === 0) state = applyLiveEvent(state, identity(), { kind: "start" }, Date.now());
      state = applyLiveEvent(state, identity(), live, Date.now());
      let created: HTMLElement | null = null;
      const watchable = live.kind === "tool-draft" || (live.kind === "tool-call" && WATCHED_TOOLS.has(live.name));
      if (window_ === null && watchable && options.enabled()) {
        const stop = options.stop;
        window_ = createLiveWindow({
          look: options.look(),
          lines: 16,
          ...(stop === undefined ? {} : { stop: () => ({ label: "Stop", run: () => stop() }) }),
          ...(options.onMenu === undefined ? {} : { onMenu: options.onMenu }),
        });
        window_.element.classList.add("live-window-inline");
        created = window_.element;
        ticker = window.setInterval(() => paint.schedule(), 1_000);
      }
      if (window_ !== null) paint.schedule();
      return created;
    },
    reset() {
      stopTicker();
      if (window_ !== null) typedBefore += window_.typed();
      window_ = null;
      state = emptyLiveRoom();
    },
    finish(ok) {
      stopTicker();
      if (state.agents.length === 0) return;
      state = applyLiveEvent(state, identity(), { kind: "end", ok }, Date.now());
      if (window_ !== null) {
        window_.element.dataset["settled"] = "true";
        paint.schedule();
        paint.flush();
      }
    },
    typed: () => typedBefore + (window_?.typed() ?? 0),
  };
}
