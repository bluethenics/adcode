/**
 * Inline completion scheduling.
 *
 * Brief §1 states the constraint absolutely: "No AI feature may block a keystroke. Ever,
 * under any latency or failure condition." §5.3 spells out the mechanism: ghost text,
 * tab to accept, "debounced and cancellable... fired on an idle callback and abandoned
 * the instant the user types again."
 *
 * This is written as a pure state machine rather than a bundle of timers for one reason:
 * a timer-based implementation can only be tested by waiting, and the guarantee that
 * matters here - that no request ever races a keystroke - is exactly the kind that hides
 * in the gaps between waits. As a transition function it is exhaustively testable, and
 * the host supplies the actual timers.
 *
 * Pure: no clock, no I/O.
 */

/** §5.3's idle callback delay. Long enough not to fire mid-word, short enough to feel live. */
export const IDLE_MS = 250;

export interface Suggestion {
  readonly requestId: number;
  readonly text: string;
}

export interface CompletionState {
  readonly enabled: boolean;
  /** When the user last typed. Requests are measured from here. */
  readonly lastKeystrokeAt: number;
  /** The request we are waiting on, or `null` when idle. */
  readonly inFlightRequestId: number | null;
  readonly suggestion: Suggestion | null;
  readonly nextRequestId: number;
}

export type CompletionEvent =
  | { readonly kind: "keystroke"; readonly at: number }
  | { readonly kind: "idle-elapsed"; readonly at: number }
  | { readonly kind: "response"; readonly requestId: number; readonly text: string }
  | { readonly kind: "accept" }
  | { readonly kind: "dismiss" };

export type CompletionEffect =
  | { readonly kind: "none" }
  /** Fire a completion request. The host must abandon it if `cancel` follows. */
  | { readonly kind: "request"; readonly requestId: number }
  /** Abandon the in-flight request; its result must never be shown. */
  | { readonly kind: "cancel"; readonly requestId: number }
  | { readonly kind: "show"; readonly text: string }
  | { readonly kind: "hide" }
  | { readonly kind: "accept"; readonly text: string };

export function initialCompletionState(now: number, enabled = true): CompletionState {
  return {
    enabled,
    lastKeystrokeAt: now,
    inFlightRequestId: null,
    suggestion: null,
    nextRequestId: 1,
  };
}

export interface CompletionDecision {
  readonly state: CompletionState;
  readonly effect: CompletionEffect;
}

const NONE: CompletionEffect = { kind: "none" };

export function decideCompletion(
  state: CompletionState,
  event: CompletionEvent,
): CompletionDecision {
  switch (event.kind) {
    case "keystroke": {
      // The user typed. Anything in flight is now stale by definition - the context it
      // was computed against no longer exists - and any visible ghost text is wrong.
      const next: CompletionState = {
        ...state,
        lastKeystrokeAt: event.at,
        inFlightRequestId: null,
        suggestion: null,
      };

      if (state.inFlightRequestId !== null) {
        return { state: next, effect: { kind: "cancel", requestId: state.inFlightRequestId } };
      }
      return { state: next, effect: NONE };
    }

    case "idle-elapsed": {
      if (!state.enabled) return { state, effect: NONE };
      if (state.inFlightRequestId !== null) return { state, effect: NONE };
      // The host may fire this early; the state machine is the authority on whether the
      // idle period has genuinely elapsed.
      if (event.at - state.lastKeystrokeAt < IDLE_MS) return { state, effect: NONE };

      const requestId = state.nextRequestId;
      return {
        state: { ...state, inFlightRequestId: requestId, nextRequestId: requestId + 1 },
        effect: { kind: "request", requestId },
      };
    }

    case "response": {
      // Only the response to the live request may be shown. Anything else is the answer
      // to a question the user has already moved on from.
      if (event.requestId !== state.inFlightRequestId) return { state, effect: NONE };
      if (event.text.length === 0) {
        return { state: { ...state, inFlightRequestId: null }, effect: NONE };
      }

      return {
        state: {
          ...state,
          inFlightRequestId: null,
          suggestion: { requestId: event.requestId, text: event.text },
        },
        effect: { kind: "show", text: event.text },
      };
    }

    case "accept": {
      if (state.suggestion === null) return { state, effect: NONE };
      return {
        state: { ...state, suggestion: null },
        effect: { kind: "accept", text: state.suggestion.text },
      };
    }

    case "dismiss": {
      if (state.suggestion === null) return { state, effect: NONE };
      return { state: { ...state, suggestion: null }, effect: { kind: "hide" } };
    }

    default:
      return { state, effect: NONE };
  }
}
