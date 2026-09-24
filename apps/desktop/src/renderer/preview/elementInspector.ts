/**
 * Element inspector for the live preview.
 *
 * Right-click an element in the preview and this shows its box model — width,
 * height, padding, margin — plus the markup to restyle, highlighted. Because a
 * right-click lands on the innermost span while the person usually meant the
 * card around it, the panel also shows the ancestor breadcrumb: every level
 * from the body down to the click, each with its own size, so picking the
 * intended element is one click, not a fresh right-click and a guess. A second
 * view lists every element's box so padding drift across a page is visible at
 * a glance.
 *
 * Why this lives beside the preview rather than in devtools: the people this
 * preview exists for do not have devtools open. They are adjusting a layout and
 * want the numbers where the page is, in words the stylesheet uses.
 *
 * The bridge is `postMessage`, not DOM access. The iframe is cross-origin
 * against `app://adcode`, so the workbench cannot read into it; the injected
 * script in `liveServer.ts` (`INSPECT_SCRIPT`) posts `adcode-inspect` messages
 * out and answers `adcode-preview` messages in. This file is the other end.
 */
import { copyText } from "../clipboard.ts";

export interface BoxEdges {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}

export interface InspectedBox {
  readonly tag: string;
  readonly id: string | null;
  readonly classes: readonly string[];
  readonly selector: string;
  readonly width: number;
  readonly height: number;
  readonly padding: BoxEdges;
  readonly margin: BoxEdges;
  readonly border: BoxEdges;
  readonly display: string;
  readonly position: string;
  readonly html: string;
}

export interface ElementInspectorDeps {
  /** The preview iframe. Only ever posted messages to, never read from. */
  readonly frame: HTMLIFrameElement;
}

/**
 * One right-click: the element under the pointer plus its ancestors,
 * outermost first. The ancestors are what rescues a mis-clicked span.
 */
export interface InspectHit {
  readonly current: InspectedBox;
  readonly chain: readonly InspectedBox[];
}

export interface ElementInspector {
  readonly element: HTMLElement;
  isActive(): boolean;
  setActive(active: boolean): void;
  toggle(): void;
  /** Show one right-clicked element, with its ancestor chain when known. */
  showHit(box: InspectedBox, chain?: readonly InspectedBox[]): void;
  /** Show the whole-page inventory. */
  showList(boxes: readonly InspectedBox[]): void;
  clear(): void;
  /** Ask the page for its whole-page inventory. No-op when inactive. */
  requestList(): void;
  /** Handle a message posted out of the preview page. Returns true when consumed. */
  handleMessage(data: unknown): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInspectedBox(value: unknown): value is InspectedBox {
  if (!isRecord(value)) return false;
  return (
    typeof value["tag"] === "string" &&
    typeof value["selector"] === "string" &&
    typeof value["width"] === "number" &&
    typeof value["height"] === "number" &&
    typeof value["html"] === "string" &&
    isRecord(value["padding"]) &&
    isRecord(value["margin"])
  );
}

/** The `{ current, chain }` envelope the injected script posts since the chain landed. */
export function isInspectHit(value: unknown): value is InspectHit {
  if (!isRecord(value)) return false;
  if (!isInspectedBox(value["current"])) return false;
  const chain = value["chain"];
  return Array.isArray(chain) && (chain as unknown[]).every(isInspectedBox);
}

function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

/** One-line summary used for list rows and the panel header. */
export function describeBox(box: InspectedBox): string {
  return `${shortLabel(box)} · ${box.width} × ${box.height}`;
}

/** The element without its size: `div#hero.card`. Breadcrumb text. */
export function shortLabel(box: InspectedBox): string {
  const id = box.id !== null && box.id !== "" ? `#${box.id}` : "";
  const cls = box.classes.length > 0 ? `.${box.classes.slice(0, 2).join(".")}` : "";
  return `${box.tag}${id}${cls}`;
}

function edgesSummary(edges: BoxEdges): string {
  if (edges.top === edges.right && edges.right === edges.bottom && edges.bottom === edges.left) {
    return edges.top;
  }
  return `${edges.top} ${edges.right} ${edges.bottom} ${edges.left}`;
}

/** Very small highlighter: tags, attributes, strings get spans. Escaped first. */
export function highlightHtml(html: string): string {
  const escaped = escapeHtml(html);
  return escaped
    .split(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g)
    .map((chunk) => {
      if (/^&lt;\/?[a-zA-Z]/.test(chunk)) return `<span class="inspect-tag">${chunk}</span>`;
      return chunk
        .replace(/([a-zA-Z-]+)=(&quot;.*?&quot;)/g, `<span class="inspect-attr">$1</span>=<span class="inspect-string">$2</span>`);
    })
    .join("");
}

export function createElementInspector(deps: ElementInspectorDeps): ElementInspector {
  const element = document.createElement("div");
  element.className = "inspect-panel";
  element.hidden = true;

  const header = document.createElement("div");
  header.className = "inspect-header";

  const title = document.createElement("span");
  title.className = "inspect-title";
  title.textContent = "Inspect";

  const hint = document.createElement("span");
  hint.className = "inspect-hint";
  hint.textContent = "Right-click an element in the preview";

  const listButton = document.createElement("button");
  listButton.type = "button";
  listButton.className = "ghost-button device-action";
  listButton.textContent = "List all";
  listButton.title = "Show width, padding and margin for every element on the page";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ghost-button device-action";
  closeButton.textContent = "Close";
  closeButton.title = "Close the inspector";

  header.append(title, hint, listButton, closeButton);

  const body = document.createElement("div");
  body.className = "inspect-body";

  const empty = document.createElement("p");
  empty.className = "inspect-empty";
  empty.textContent = "Turn on Inspect, then right-click anything in the preview. If it grabs a smaller piece than you meant, walk up the breadcrumb to the parent you wanted.";

  const detail = document.createElement("div");
  detail.className = "inspect-detail";
  detail.hidden = true;

  const listWrap = document.createElement("div");
  listWrap.className = "inspect-list-wrap";
  listWrap.hidden = true;

  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "inspect-filter";
  filter.placeholder = "Filter elements…";
  filter.setAttribute("aria-label", "Filter inspected elements");

  const list = document.createElement("div");
  list.className = "inspect-list";
  list.setAttribute("role", "list");

  listWrap.append(filter, list);
  body.append(empty, detail, listWrap);
  element.append(header, body);

  let active = false;
  let lastBoxes: readonly InspectedBox[] = [];

  function post(kind: string, extra?: Record<string, unknown>): void {
    try {
      deps.frame.contentWindow?.postMessage(
        { source: "adcode-preview", kind, ...(extra ?? {}) },
        "*",
      );
    } catch {
      // The frame may have no document yet (preview just opened). Listing then
      // is a no-op the user repeats once the page loads.
    }
  }

  function renderDetail(box: InspectedBox, chain: readonly InspectedBox[] = []): void {
    detail.replaceChildren();
    detail.hidden = false;
    listWrap.hidden = true;
    empty.hidden = true;

    /*
     * The breadcrumb: every ancestor from the body down to the click, each a
     * button showing its own size. Right-clicks land innermost, so this is
     * where "that span, no, the heading, no, the card" gets resolved - one
     * click per level, with the page flashing the newly picked element.
     */
    if (chain.length > 0) {
      const crumbs = document.createElement("nav");
      crumbs.className = "inspect-crumbs";
      crumbs.setAttribute("aria-label", "Elements from the page down to your right-click");
      const levels: readonly InspectedBox[] = [...chain, box];
      levels.forEach((level, index) => {
        if (index > 0) {
          const sep = document.createElement("span");
          sep.className = "inspect-crumb-sep";
          sep.textContent = "›";
          sep.setAttribute("aria-hidden", "true");
          crumbs.append(sep);
        }
        const crumb = document.createElement("button");
        crumb.type = "button";
        crumb.className = "inspect-crumb";
        crumb.textContent = shortLabel(level);
        crumb.title = `${describeBox(level)}\n${level.selector}\nClick to see this element instead`;
        crumb.setAttribute("aria-label", `Show ${describeBox(level)} instead`);
        if (index === levels.length - 1) {
          crumb.dataset["current"] = "true";
          crumb.setAttribute("aria-current", "true");
        } else {
          crumb.addEventListener("click", () => {
            post("inspect-flash", { selector: level.selector });
            renderDetail(level, chain);
          });
        }
        crumbs.append(crumb);
      });
      const note = document.createElement("div");
      note.className = "inspect-crumb-note";
      note.textContent = "Wrong element? Walk up to the one you meant.";
      detail.append(crumbs, note);
    }

    const name = document.createElement("div");
    name.className = "inspect-selector";
    name.textContent = describeBox(box);

    const meta = document.createElement("div");
    meta.className = "inspect-meta";
    meta.textContent = `${box.selector} · display ${box.display} · position ${box.position}`;

    const grid = document.createElement("dl");
    grid.className = "inspect-grid";
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["Width", `${box.width}px`],
      ["Height", `${box.height}px`],
      ["Padding", edgesSummary(box.padding)],
      ["Margin", edgesSummary(box.margin)],
      ["Border", edgesSummary(box.border)],
    ];
    for (const [term, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      grid.append(dt, dd);
    }

    const model = document.createElement("div");
    model.className = "inspect-model";
    model.title = "Box model: margin outside, then border, then padding, then the element itself";
    const margin = document.createElement("div");
    margin.className = "inspect-margin";
    const border = document.createElement("div");
    border.className = "inspect-border";
    const padding = document.createElement("div");
    padding.className = "inspect-padding";
    const content = document.createElement("div");
    content.className = "inspect-content";
    content.textContent = `${box.width} × ${box.height}`;
    const marginLabel = document.createElement("span");
    marginLabel.className = "inspect-model-label";
    marginLabel.textContent = `margin ${edgesSummary(box.margin)}`;
    const paddingLabel = document.createElement("span");
    paddingLabel.className = "inspect-model-label";
    paddingLabel.textContent = `padding ${edgesSummary(box.padding)}`;
    padding.append(content, paddingLabel);
    border.append(padding);
    margin.append(border, marginLabel);
    model.append(margin);

    const codeHead = document.createElement("div");
    codeHead.className = "inspect-code-head";
    const codeLabel = document.createElement("span");
    codeLabel.textContent = "Markup to restyle";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost-button device-action";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      copy.disabled = true;
      void copyText(box.html).then((ok) => {
        copy.textContent = ok ? "Copied" : "Copy failed";
        window.setTimeout(() => {
          copy.textContent = "Copy";
          copy.disabled = false;
        }, 1200);
      });
    });
    codeHead.append(codeLabel, copy);

    const code = document.createElement("pre");
    code.className = "inspect-code";
    code.tabIndex = 0;
    code.innerHTML = highlightHtml(box.html);

    detail.append(name, meta, grid, model, codeHead, code);
  }

  function renderList(boxes: readonly InspectedBox[]): void {
    lastBoxes = boxes;
    detail.hidden = true;
    listWrap.hidden = false;
    empty.hidden = true;
    drawRows(filter.value);
  }

  function drawRows(query: string): void {
    list.replaceChildren();
    const needle = query.trim().toLowerCase();
    const shown = lastBoxes.filter((box) =>
      needle === "" ||
      box.selector.toLowerCase().includes(needle) ||
      box.tag.includes(needle) ||
      describeBox(box).toLowerCase().includes(needle),
    );
    if (shown.length === 0) {
      const none = document.createElement("p");
      none.className = "inspect-empty";
      none.textContent =
        lastBoxes.length === 0
          ? "No elements reported. The page may still be loading — try List all again."
          : "Nothing matches that filter.";
      list.append(none);
      return;
    }
    for (const box of shown.slice(0, 300)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "inspect-row";
      row.setAttribute("role", "listitem");
      row.title = `${box.selector}\nClick to see its box model and code`;

      const main = document.createElement("span");
      main.className = "inspect-row-main";
      main.textContent = describeBox(box);

      const sub = document.createElement("span");
      sub.className = "inspect-row-sub";
      sub.textContent = `pad ${edgesSummary(box.padding)} · mar ${edgesSummary(box.margin)}`;

      row.append(main, sub);
      row.addEventListener("click", () => renderDetail(box, []));
      list.append(row);
    }
  }

  filter.addEventListener("input", () => drawRows(filter.value));

  listButton.addEventListener("click", () => api.requestList());
  closeButton.addEventListener("click", () => api.setActive(false));

  const api: ElementInspector = {
    element,

    isActive: () => active,

    setActive(next: boolean): void {
      active = next;
      element.hidden = !next;
      post("inspect-enable", { enabled: next });
      if (next) {
        empty.hidden = false;
        detail.hidden = true;
        listWrap.hidden = true;
      }
    },

    toggle(): void {
      api.setActive(!active);
    },

    showHit(box: InspectedBox, chain: readonly InspectedBox[] = []): void {
      if (!active) api.setActive(true);
      renderDetail(box, chain);
    },

    showList(boxes: readonly InspectedBox[]): void {
      if (!active) api.setActive(true);
      renderList(boxes);
    },

    clear(): void {
      detail.hidden = true;
      listWrap.hidden = true;
      empty.hidden = false;
      detail.replaceChildren();
      list.replaceChildren();
      lastBoxes = [];
    },

    requestList(): void {
      if (!active) api.setActive(true);
      post("inspect-list");
    },

    handleMessage(data: unknown): boolean {
      if (!isRecord(data) || data["source"] !== "adcode-inspect") return false;
      const kind = data["kind"];
      if (kind === "inspect-hit") {
        // The envelope since the chain landed; a bare box from an older page
        // still draws, just without ancestors to walk up to.
        if (isInspectHit(data["payload"])) {
          api.showHit(data["payload"].current, data["payload"].chain);
          return true;
        }
        if (isInspectedBox(data["payload"])) {
          api.showHit(data["payload"], []);
          return true;
        }
        return false;
      }
      if (kind === "inspect-list" && Array.isArray(data["payload"])) {
        const boxes = (data["payload"] as unknown[]).filter(isInspectedBox);
        api.showList(boxes);
        return true;
      }
      // inspect-ready and anything future: consumed, nothing to draw.
      if (kind === "inspect-ready") return true;
      return false;
    },
  };

  return api;
}
