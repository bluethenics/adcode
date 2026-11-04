/**
 * Static glyphs with pointer feedback; no animation loop runs while the app is idle.
 *
 * Under the pointer the field thickens - glyphs within a few cells climb the density ramp - so
 * the characters themselves answer the hand, not only the glow behind them. Work happens once
 * per animation frame and only while the pointer moves; leaving restores the resting field.
 */
const COLS = 150, ROWS = 90, RADIUS = 9, LIFT = .7;

export function createAccountBackdrop(host: HTMLElement) {
  const element = document.createElement("div"); element.className = "account-gate-backdrop"; element.setAttribute("aria-hidden", "true");
  const art = document.createElement("pre"); art.className = "account-gate-art";
  const glyphs = " .·:+*#", density = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const nx = (x - COLS / 2) / (COLS / 2), ny = (y - ROWS / 2) / (ROWS / 2);
      const wave = Math.sin(nx * 8 + Math.sin(ny * 4) * 2) * Math.cos(ny * 7 - nx * 3);
      density[y * COLS + x] = Math.max(0, (1 - Math.hypot(nx * .72, ny * .6)) * (.55 + wave * .45));
    }
  }
  const glyph = (value: number): string => glyphs[Math.min(glyphs.length - 1, Math.floor(value * glyphs.length))]!;
  const render = (col: number, row: number): string => {
    const lines: string[] = [];
    for (let y = 0; y < ROWS; y++) {
      let line = "";
      for (let x = 0; x < COLS; x++) {
        // Cells are about twice as tall as wide, so rows count double towards the distance.
        const reach = 1 - Math.hypot(x - col, (y - row) * 2) / RADIUS;
        line += glyph(density[y * COLS + x]! + (reach > 0 ? reach * reach * LIFT : 0));
      }
      lines.push(line);
    }
    return lines.join("\n");
  };
  const resting = render(-RADIUS * 4, -RADIUS * 4);
  art.textContent = resting;
  const light = document.createElement("div"); light.className = "account-gate-light";
  element.append(art, light);
  let frame = 0, x = 0, y = 0, lit = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  function move(event: PointerEvent) {
    if (motion.matches || document.documentElement.dataset["reducedMotion"] === "true" || !pointer.matches) return;
    x = event.clientX; y = event.clientY;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0; light.style.transform = `translate(${x - 180}px, ${y - 180}px)`; light.style.opacity = "1";
      const box = art.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      art.textContent = render(Math.round((x - box.left) / (box.width / COLS)), Math.round((y - box.top) / (box.height / ROWS)));
      lit = true;
    });
  }
  function leave() {
    cancelAnimationFrame(frame); frame = 0; light.style.opacity = "0";
    if (lit) { art.textContent = resting; lit = false; }
  }
  return {
    element,
    activate() { host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave); },
    deactivate() { host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); leave(); },
  };
}
