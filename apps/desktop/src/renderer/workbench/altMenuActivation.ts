/**
 * When a press of Alt means "focus the menu bar", and when it is part of a chord.
 *
 * Windows opens the menu bar on Alt, but on *keyup*, and only when Alt was pressed and
 * released with nothing in between. Deciding it on keydown instead - as this shell used
 * to - breaks every Alt chord the editor owns, because the `Alt` keydown always arrives
 * before the key it modifies:
 *
 *   Alt+Up / Alt+Down            move line up / down
 *   Shift+Alt+Up / Down          copy line up / down
 *   Shift+Alt+Left / Right       expand / shrink selection
 *   Ctrl+Alt+Up / Down           add cursor above / below
 *
 * Opening the menu at that point pulls DOM focus out of Monaco, so the arrow key that
 * follows walks the menu instead of the code. Reading `ctrlKey`/`shiftKey` on the Alt
 * keydown does not save it either: those are only true if the other modifier was pressed
 * *first*, which is why the four chords above used to work or not depending on the order
 * the user happened to hold them down.
 *
 * Pure, so the orderings can be exercised without a window - the `layoutSizes.ts`
 * precedent. The shell feeds it real events and acts on what `keyup` returns.
 */

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  /** Auto-repeat while the key is held. */
  readonly repeat?: boolean;
}

export interface AltMenuActivation {
  keydown(event: KeyLike): void;
  /** True when this keyup is a bare Alt that should open the menu bar. */
  keyup(event: KeyLike): boolean;
  /** A pointer press, a lost window, or a modal taking over. All cancel a pending Alt. */
  cancel(): void;
  isArmed(): boolean;
}

export function createAltMenuActivation(): AltMenuActivation {
  let armed = false;

  return {
    keydown(event) {
      if (event.key !== "Alt") {
        // Any other key while Alt is down makes this a chord, not a menu request.
        armed = false;
        return;
      }

      // Repeats while Alt is held are the same press; they must not re-arm after a chord
      // has already disarmed it, and must not toggle anything on their own.
      if (event.repeat === true) return;

      // Ctrl+Alt is AltGr on several keyboard layouts, where Alt is not a menu key at all.
      armed = !event.ctrlKey && !event.shiftKey && !event.metaKey;
    },

    keyup(event) {
      if (event.key !== "Alt") return false;

      const activate = armed;
      armed = false;
      return activate;
    },

    cancel() {
      armed = false;
    },

    isArmed: () => armed,
  };
}
