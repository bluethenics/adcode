/** Panel sizes follow the actual popup, including while its outer edge is resized. */
export function attachChatLayout(card: HTMLElement, body: HTMLElement): () => void {
  const sizes = { history: 240, inspector: 320 };
  type Panel = keyof typeof sizes;
  const defaults = { ...sizes };
  try {
    const saved = JSON.parse(localStorage.getItem("adcode.chat.panelSizes") ?? "null") as typeof sizes | null;
    for (const panel of ["history", "inspector"] as const) {
      if (saved && Number.isFinite(saved[panel])) sizes[panel] = Math.max(200, Math.min(480, saved[panel]));
    }
  } catch { /* Storage is optional. */ }
  const handles = new Map<Panel, HTMLElement>();
  const save = (): void => {
    try { localStorage.setItem("adcode.chat.panelSizes", JSON.stringify(sizes)); } catch { /* Optional. */ }
  };
  const update = (): void => {
    const width = body.clientWidth;
    if (!width) return;
    const compact = width <= 720;
    const overlayInspector = width <= 980;
    card.dataset["layout"] = compact ? "compact" : overlayInspector ? "medium" : "wide";
    const historyOpen = card.dataset["historyOpen"] === "true";
    const inspectorOpen = card.dataset["inspectorOpen"] === "true";
    const historyLimit = compact ? width * .88 : width - 360 - (inspectorOpen && !overlayInspector ? 200 : 0);
    const historyWidth = Math.min(sizes.history, historyLimit);
    const inspectorWidth = Math.min(sizes.inspector, overlayInspector ? width * .88 : width - (historyOpen ? historyWidth : 0) - 360);
    card.style.setProperty("--chat-history-width", `${historyWidth}px`);
    card.style.setProperty("--chat-inspector-width", `${inspectorWidth}px`);
    body.style.gridTemplateColumns = [historyOpen && !compact ? `${historyWidth}px` : "", "minmax(0, 1fr)", inspectorOpen && !overlayInspector ? `${inspectorWidth}px` : ""].filter(Boolean).join(" ");
    body.style.gridTemplateAreas = `"${[historyOpen && !compact ? "history" : "", "conversation", inspectorOpen && !overlayInspector ? "inspector" : ""].filter(Boolean).join(" ")}"`;
    for (const [panel, handle] of handles) {
      handle.hidden = card.dataset[`${panel}Open`] !== "true";
      const actual = panel === "history" ? historyWidth : inspectorWidth;
      handle.style[panel === "history" ? "left" : "right"] = `${actual - 5}px`;
      handle.setAttribute("aria-valuenow", String(Math.round(actual)));
      handle.setAttribute("aria-valuemin", String(Math.round(Math.min(200, actual))));
      handle.setAttribute("aria-valuemax", String(Math.round(panel === "history" ? Math.min(480, historyLimit) : Math.min(480, overlayInspector ? width * .88 : width - (historyOpen ? historyWidth : 0) - 360))));
    }
  };
  for (const panel of ["history", "inspector"] as const) {
    const handle = document.createElement("div");
    handle.className = "chat-panel-divider";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize ${panel}`);
    handle.setAttribute("aria-valuemin", "200");
    handle.title = `Drag to resize ${panel}. Arrow keys adjust; double-click resets.`;
    let drag: { x: number; width: number; id: number } | null = null;
    const setSize = (value: number): void => {
      sizes[panel] = Math.max(Math.min(200, Number(handle.getAttribute("aria-valuemax"))), Math.min(Number(handle.getAttribute("aria-valuemax")), value));
      update();
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.focus();
      handle.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, width: Number(handle.getAttribute("aria-valuenow")), id: event.pointerId };
      card.dataset["resizing"] = "true";
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      setSize(drag.width + (event.clientX - drag.x) * (panel === "history" ? 1 : -1));
    });
    const finish = (): void => { drag = null; delete card.dataset["resizing"]; save(); };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("dblclick", () => { setSize(defaults[panel]); save(); });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = Number(handle.getAttribute("aria-valuenow"));
      const delta = (event.key === "ArrowRight" ? 1 : -1) * (panel === "history" ? 1 : -1) * (event.shiftKey ? 40 : 16);
      setSize(event.key === "Home" ? 200 : event.key === "End" ? 480 : current + delta);
      save();
    });
    handles.set(panel, handle);
    body.append(handle);
  }
  new ResizeObserver(update).observe(body);
  return update;
}
