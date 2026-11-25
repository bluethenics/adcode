/**
 * Keeping a day-long conversation fast.
 *
 * People who use the assistant all day leave one chat open for hours: thousands of messages,
 * each with rendered Markdown, code blocks, timelines and diffs. Every one of them stayed in
 * the page, so style and layout work grew with the day, and reopening such a chat rendered
 * all of it before showing anything.
 *
 * Two things fix it without losing a word:
 *
 *  - **Reopening** draws only the newest messages (`RESTORE_WINDOW`, starting at a message the
 *    person wrote). Older ones are drawn on demand from a "Show earlier messages" bar, a batch
 *    at a time, above what is on screen.
 *  - **A live chat** sets its oldest finished elements aside once the transcript passes
 *    `LIVE_MAX`, keeping the newest `LIVE_KEEP`. Set-aside elements are detached, not destroyed
 *    - their buttons and state survive - and the same bar puts them back.
 *
 * Only elements at the very top move, and never one the chat says is protected (a card still
 * waiting on the person, the live agents card, the working indicator). Trimming happens only
 * while the person is reading at the bottom, and the view is re-anchored to the bottom so
 * nothing on screen moves. The DOM pieces are injected, so the rules are tested without one.
 */

/** Messages drawn when a conversation is reopened. */
export const RESTORE_WINDOW = 120;
/** Transcript elements past which the oldest are set aside. */
export const LIVE_MAX = 700;
/** Elements kept when the transcript is trimmed. */
export const LIVE_KEEP = 450;
/** How many come back per press of "Show earlier messages". */
export const SHOW_BATCH = 150;

/**
 * Where a reopened conversation starts drawing: the newest `window` messages, moved back to the
 * person's own message so the first thing on screen is a question, not half an answer.
 */
export function restoreStart(roles: readonly string[], window = RESTORE_WINDOW): number {
  if (roles.length <= window) return 0;
  let start = roles.length - window;
  while (start > 0 && roles[start] !== "user") start -= 1;
  return start;
}

/**
 * Which message each recorded edit is drawn before: the first message newer than the edit,
 * or `messageTimes.length` (the end) when none is. Mirrors how the full redraw interleaves them.
 */
export function editSlots(editTimes: readonly number[], messageTimes: readonly number[]): number[] {
  return editTimes.map((at) => {
    const index = messageTimes.findIndex((messageAt) => at < messageAt);
    return index === -1 ? messageTimes.length : index;
  });
}

/** The earliest batch still to draw, ending at `end` (exclusive), starting at a user message when it can. */
export function earlierBatch(roles: readonly string[], end: number, batch = SHOW_BATCH): { readonly from: number; readonly to: number } {
  const to = Math.max(0, Math.min(end, roles.length));
  let from = Math.max(0, to - batch);
  while (from > 0 && roles[from] !== "user") from -= 1;
  return { from, to };
}

/** The slice of the DOM the window needs; the transcript element satisfies it. */
export interface WindowHost {
  readonly children: ArrayLike<WindowNode>;
  insertBefore(node: Node, reference: Node | null): unknown;
  prepend(...nodes: Node[]): void;
  scrollTop: number;
  readonly scrollHeight: number;
}

export type WindowNode = Element;

export interface WindowBar {
  readonly element: WindowNode;
  /** How many messages or elements are out of view above; the bar hides itself at zero. */
  setCount(hidden: number, more: boolean): void;
}

export interface TranscriptWindowOptions {
  /** True for an element that must never be set aside. */
  readonly protect: (node: WindowNode) => boolean;
  /** Whether trimming may happen now: the person is reading at the bottom. */
  readonly atBottom: () => boolean;
  /** Builds the bar; `show` is its button. */
  readonly bar: (show: () => void) => WindowBar;
  readonly max?: number;
  readonly keep?: number;
  readonly batch?: number;
}

export type UndrawnRenderer = (count: number) => { readonly nodes: readonly WindowNode[]; readonly drawn: number };

export interface TranscriptWindow {
  /**
   * A reopened conversation's older messages, not drawn yet. `render(count)` draws about the
   * newest `count` of those still undrawn by appending them, and returns what it appended, in
   * order, with how many messages that was (it may round back to the person's message).
   */
  setUndrawn(count: number, render: UndrawnRenderer): void;
  /** Set the oldest elements aside if the transcript has grown past the limit. */
  trim(): void;
  /** Bring back the next batch above what is on screen, keeping the view where it is. */
  showEarlier(): void;
  /** The transcript was emptied (another chat opened): forget everything set aside. */
  reset(): void;
  /** Elements set aside plus messages not yet drawn. */
  hidden(): number;
}

export function createTranscriptWindow(host: WindowHost, options: TranscriptWindowOptions): TranscriptWindow {
  const max = options.max ?? LIVE_MAX;
  const keep = options.keep ?? LIVE_KEEP;
  const batch = options.batch ?? SHOW_BATCH;
  /** Detached elements, oldest first. */
  let aside: WindowNode[] = [];
  let undrawn: { count: number; render: UndrawnRenderer } | null = null;
  let bar: WindowBar | null = null;
  let mounted = false;

  const total = (): number => aside.length + (undrawn?.count ?? 0);

  function ensureBar(): WindowBar {
    bar ??= options.bar(() => api.showEarlier());
    return bar;
  }

  function paintBar(): void {
    const hidden = total();
    if (hidden === 0) {
      if (mounted && bar !== null) bar.element.remove();
      mounted = false;
      return;
    }
    const current = ensureBar();
    if (!mounted || host.children[0] !== current.element) host.prepend(current.element);
    mounted = true;
    current.setCount(hidden, undrawn !== null && undrawn.count > 0);
  }

  /** The element the bar sits above, or the first one when there is no bar. */
  function firstContent(): WindowNode | null {
    const first = host.children[0] ?? null;
    if (first !== null && mounted && bar !== null && first === bar.element) return host.children[1] ?? null;
    return first;
  }

  /** Run `change`, keeping the content on screen where it was relative to the bottom. */
  function anchored(change: () => void): void {
    const fromBottom = host.scrollHeight - host.scrollTop;
    change();
    host.scrollTop = Math.max(0, host.scrollHeight - fromBottom);
  }

  const api: TranscriptWindow = {
    setUndrawn(count, render) {
      undrawn = count > 0 ? { count, render } : null;
      paintBar();
    },

    trim() {
      const content = Array.from(host.children).filter((node) => !(mounted && bar !== null && node === bar.element));
      if (content.length <= max || !options.atBottom()) return;
      const moving: WindowNode[] = [];
      for (const node of content) {
        if (content.length - moving.length <= keep || options.protect(node)) break;
        moving.push(node);
      }
      if (moving.length === 0) return;
      anchored(() => {
        for (const node of moving) node.remove();
        aside = [...aside, ...moving];
        paintBar();
      });
    },

    showEarlier() {
      if (total() === 0) return;
      anchored(() => {
        if (aside.length > 0) {
          const back = aside.slice(-batch);
          aside = aside.slice(0, aside.length - back.length);
          const reference = firstContent();
          for (const node of back) host.insertBefore(node, reference);
        } else if (undrawn !== null) {
          const reference = firstContent();
          const result = undrawn.render(Math.min(batch, undrawn.count));
          // Drawn at the end by the chat's own renderer; moved up above what was on screen.
          for (const node of result.nodes) host.insertBefore(node, reference);
          const left = undrawn.count - Math.max(1, result.drawn);
          undrawn = left > 0 ? { count: left, render: undrawn.render } : null;
        }
        paintBar();
      });
    },

    reset() {
      aside = [];
      undrawn = null;
      if (mounted && bar !== null) bar.element.remove();
      mounted = false;
    },

    hidden: total,
  };
  return api;
}
