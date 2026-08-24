/**
 * The Output tab: named log channels.
 *
 * Every channel here is text the main process already produced and then dropped on the
 * floor. The language server's stderr was read and discarded to keep its pipe from
 * filling; git's explanation of a failed push lived only as long as the toast that showed
 * one line of it; the dev server's output reached the preview drawer and nowhere you could
 * scroll back through. So "why did that not work" had no answer to look up, and this is
 * where the answer now is.
 *
 * **Follow, but not against the user.** A log that always jumps to the bottom cannot be
 * read while it is being written, and one that never does is useless for watching a build.
 * So it follows the tail only while the view is already scrolled to the bottom - scroll up
 * and it holds still until you come back down. This is the same rule a terminal uses, and
 * people already know it without being told.
 */
import type { OutputChannelId, OutputLine } from "../../shared/api.ts";

export interface OutputPanelDeps {
  readonly history: () => Promise<OutputLine[]>;
  readonly onAppend: (listener: (line: OutputLine) => void) => () => void;
}

export interface OutputPanel {
  readonly element: HTMLElement;
  /** The channel picker and Clear button, for the panel header. */
  readonly actions: HTMLElement;
  /** Load history and start listening. Safe to call more than once. */
  open(): Promise<void>;
  /** Show a particular channel, e.g. when a build fails. */
  select(channel: OutputChannelId): void;
}

/**
 * The channels, in the order they appear.
 *
 * Ordered by how often somebody needs them rather than alphabetically: a dev server that
 * will not start is the commonest wall, and the language server is the least-understood
 * one.
 */
const CHANNELS: ReadonlyArray<{ id: OutputChannelId; label: string }> = [
  { id: "dev-server", label: "Dev Server" },
  { id: "live-server", label: "Live Server" },
  { id: "git", label: "Git" },
  { id: "language-server", label: "Language Server" },
];

/** How close to the bottom still counts as "at the bottom", in pixels. */
const TAIL_SLACK = 24;

export function createOutputPanel(deps: OutputPanelDeps): OutputPanel {
  const element = document.createElement("div");
  element.className = "output-panel";

  const view = document.createElement("pre");
  view.className = "output-view";
  view.tabIndex = 0;
  element.append(view);

  const actions = document.createElement("div");
  actions.className = "panel-tab-actions";

  const picker = document.createElement("select");
  picker.className = "output-channel";
  picker.ariaLabel = "Output channel";
  for (const channel of CHANNELS) {
    const option = document.createElement("option");
    option.value = channel.id;
    option.textContent = channel.label;
    picker.append(option);
  }

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "ghost-button";
  clear.textContent = "Clear";
  // Deliberately worded as the view, not the log: the main process keeps its history and
  // this cannot delete it. A button that destroyed the only record of a failure would be
  // the opposite of what this panel is for.
  clear.title = "Clear what is shown here";

  actions.append(picker, clear);

  /** Lines per channel, mirroring what the main process kept. */
  const lines = new Map<OutputChannelId, string[]>();
  let active: OutputChannelId = "dev-server";
  let unsubscribe: (() => void) | null = null;

  const atBottom = (): boolean =>
    view.scrollHeight - view.scrollTop - view.clientHeight <= TAIL_SLACK;

  function paint(): void {
    const follow = atBottom();
    const kept = lines.get(active) ?? [];

    view.textContent = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    view.classList.toggle("output-empty", kept.length === 0);

    if (kept.length === 0) view.dataset["empty"] = "Nothing here yet.";
    else delete view.dataset["empty"];

    if (follow) view.scrollTop = view.scrollHeight;
  }

  function record(line: OutputLine): void {
    const kept = lines.get(line.channel) ?? [];
    for (const text of line.text.replace(/\n$/, "").split("\n")) kept.push(text);
    lines.set(line.channel, kept);
  }

  picker.addEventListener("change", () => {
    active = (picker.value as OutputChannelId) ?? "dev-server";
    paint();
    // A channel switch is a deliberate look at something, so it starts at the newest.
    view.scrollTop = view.scrollHeight;
  });

  clear.addEventListener("click", () => {
    lines.set(active, []);
    paint();
  });

  return {
    element,
    actions,

    async open() {
      if (unsubscribe !== null) return;

      // History first, then the live feed. The other order would drop anything printed
      // between the two calls.
      for (const line of await deps.history()) record(line);
      unsubscribe = deps.onAppend((line) => {
        record(line);
        // Only repaint when it is the channel on screen; a chatty dev server must not
        // cost a repaint while somebody reads the git log.
        if (line.channel === active) paint();
      });

      paint();
      view.scrollTop = view.scrollHeight;
    },

    select(channel) {
      active = channel;
      picker.value = channel;
      paint();
      view.scrollTop = view.scrollHeight;
    },
  };
}
