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
 * The most transcript elements held at once, on screen and set aside together - about the last
 * 500 messages. Measured on a 4,000-message chat drawn whole: 1.2 GB more memory and 350-600 ms
 * per keystroke. Older history opens as one document instead (`openAll`).
 */
export const HOLD_MAX = 1_200;

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

export interface WindowBarState {
  /** Messages or elements above that "Show earlier messages" can still bring back. */
  readonly more: number;
  /** Whether "Show earlier messages" has anything left to bring back. */
  readonly canShowMore: boolean;
  /** Older history the window no longer holds: offer the whole conversation instead. */
  readonly beyond: boolean;
}

export interface WindowBar {
  readonly element: WindowNode;
  paint(state: WindowBarState): void;
}

export interface TranscriptWindowOptions {
  /** True for an element that must never be set aside. */
  readonly protect: (node: WindowNode) => boolean;
  /** Whether trimming may happen now: the person is reading at the bottom. */
  readonly atBottom: () => boolean;
  /** Builds the bar from its two actions. */
  readonly bar: (actions: { readonly show: () => void; readonly openAll: () => void }) => WindowBar;
  /** Opens the whole conversation as one document, for history the window no longer holds. */
  readonly openAll?: () => void;
  readonly max?: number;
  readonly keep?: number;
  readonly batch?: number;
  /** The most elements held, on screen and set aside together. */
  readonly hold?: number;
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
  const hold = options.hold ?? HOLD_MAX;
  /** Detached elements, oldest first. */
  let aside: WindowNode[] = [];
  let undrawn: { count: number; render: UndrawnRenderer } | null = null;
  /** Elements were let go past `hold`: that history is only in the whole conversation now. */
  let released = false;
  let bar: WindowBar | null = null;
  let mounted = false;

  const total = (): number => aside.length + (undrawn?.count ?? 0);
  const onScreen = (): number => Array.from(host.children).filter((node) => !(mounted && bar !== null && node === bar.element)).length;
  const held = (): number => onScreen() + aside.length;
  /** Undrawn messages that may still be drawn without passing the limit. */
  const roomToDraw = (): boolean => undrawn !== null && held() < hold;

  function ensureBar(): WindowBar {
    bar ??= options.bar({ show: () => api.showEarlier(), openAll: () => options.openAll?.() });
    return bar;
  }

  function paintBar(): void {
    const canShowMore = aside.length > 0 || roomToDraw();
    const beyond = options.openAll !== undefined && (released || (undrawn !== null && !roomToDraw()));
    if (!canShowMore && !beyond) {
      if (mounted && bar !== null) bar.element.remove();
      mounted = false;
      return;
    }
    const current = ensureBar();
    if (!mounted || host.children[0] !== current.element) host.prepend(current.element);
    mounted = true;
    current.paint({ more: canShowMore ? total() : 0, canShowMore, beyond });
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
        // Past the limit, the oldest set-aside elements are let go: a day-long chat's memory
        // stays bounded, and that history is still in the whole conversation.
        const excess = held() - hold;
        if (excess > 0 && options.openAll !== undefined) {
          aside = aside.slice(Math.min(excess, aside.length));
          released = true;
        }
        paintBar();
      });
    },

    showEarlier() {
      if (aside.length === 0 && !roomToDraw()) {
        paintBar();
        return;
      }
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
      released = false;
      if (mounted && bar !== null) bar.element.remove();
      mounted = false;
    },

    hidden: total,
  };
  return api;
}
