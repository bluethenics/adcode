/**
 * One way to start a CSS transition, and the reason it is not `requestAnimationFrame`.
 *
 * A transition needs the browser to have seen the start state before it sees the end
 * state. The usual trick is to wait two animation frames. That works on a page that is on
 * screen, and this is not always a page that is on screen: Chromium throttles
 * `requestAnimationFrame` to nothing while a window is occluded, minimised, moved to
 * another desktop, or - as `scripts/smoke.mjs` does - driven headlessly over CDP. When the
 * frames do not come, they do not come *late*, they never come at all. Everything queued
 * behind them is simply lost.
 *
 * The damage is not a missing fade. `data-state` is what the rest of the app reads to know
 * a surface is open, so a sheet whose reveal was dropped is not a sheet that appeared
 * without animating - it is a sheet stuck at `opacity: 0` with no way back, holding a
 * keydown handler and a focus trap over a window the user cannot see it on. On the toast
 * path it also stranded the impression report, which is the only thing that makes a
 * sponsored notification count.
 *
 * Reading `offsetHeight` forces the pending style to be computed synchronously, which is
 * all those frames were ever for, and it cannot be throttled because it is not scheduled.
 * `helpPopover.ts` and `releaseNotice.ts` arrived at this independently and wrote the same
 * note; this is that note, in the one place the whole renderer can share.
 */
export function reveal(element: HTMLElement, state: string): void {
  void element.offsetHeight;
  element.dataset["state"] = state;
}
