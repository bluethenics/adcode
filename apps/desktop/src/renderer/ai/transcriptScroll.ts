/**
 * Landing at the end of a conversation without the trip there.
 *
 * The transcript smooth-scrolls (`scroll-behavior: smooth` in ai.css) so a reply being written
 * glides along and Jump to latest glides down. But opening or switching to a chat set
 * `scrollTop` the same way, so the window visibly travelled from the first prompt to the last
 * answer - every message of a long chat scrolled past. Claude, ChatGPT and Cursor open a chat
 * at its newest message. Reported for 2.6.5.
 *
 * Here the behaviour is switched to `auto` for exactly the one jump, then put back, so the
 * jump lands on the frame it is made and the stylesheet's smoothness stays everywhere else.
 * It also cancels a smooth scroll still running from before.
 */
export interface ScrollTarget {
  readonly scrollHeight: number;
  scrollTop: number;
  readonly style: { scrollBehavior: string };
}

export function jumpToBottom(element: ScrollTarget): void {
  const before = element.style.scrollBehavior;
  element.style.scrollBehavior = "auto";
  element.scrollTop = element.scrollHeight;
  element.style.scrollBehavior = before;
}
