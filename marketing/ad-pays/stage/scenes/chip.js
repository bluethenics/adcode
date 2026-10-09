/**
 * The earnings chip: the app's own "Earnings" button with the amount beside it, the one
 * object that runs through the whole ad. It is the hook's money, it flies into the title bar,
 * the payout lands in it, and it ticks on under the end card. One markup at every size; the
 * scenes scale it.
 */
import { counterAt, COUNTER } from "../cues.js";
import { h, put } from "../shared/engine.js";
import { markInline } from "../shared/ui.js";

export const money = (value) => `$${value.toFixed(2)}`;

export function earningsChip() {
  const amount = h("span", { class: "chip-amount" });
  const el = h("div", { class: "chip" }, markInline(16, "chip-mark"), h("span", { class: "chip-label", text: "Earnings" }), amount);
  return {
    el,
    amount,
    /** Show the counter at t; each tick gives the chip a small kick, a landed payout a big one. */
    draw(t, { landedAt = null } = {}) {
      amount.textContent = money(counterAt(t));
      const since = (t % COUNTER.every) / COUNTER.every;
      const tick = Math.exp(-since * 9) * 0.035;
      const hit = landedAt !== null && t >= landedAt ? Math.exp(-(t - landedAt) * 7) * 0.25 : 0;
      put(amount, { transform: `scale(${(1 + tick + hit).toFixed(4)})` });
      return hit;
    },
  };
}
