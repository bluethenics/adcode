/** Pipeline check only: the time in big type over a moving bar. Replaced by the real film. */
import { h, put, tf } from "../engine.js";

export const placeholder = {
  id: "placeholder",
  from: 0,
  to: 30.1,
  mount(root) {
    this.time = h("div", { class: "placeholder-time" });
    this.bar = h("div", { class: "placeholder-bar" });
    root.append(this.time, this.bar);
  },
  draw(t) {
    this.time.textContent = `${t.toFixed(2)}s`;
    put(this.bar, { transform: tf({ x: (t / 30) * 700 }) });
  },
};
