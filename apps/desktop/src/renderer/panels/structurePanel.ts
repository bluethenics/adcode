/**
 * The Structure view: the file you are in, drawn as a tree.
 *
 * Every editor has an outline. Almost none of them are worth opening, for one reason: they
 * are a flat-ish list of names, and a name is the least interesting thing about a
 * declaration. This one answers the two questions a reader actually has, in place, without
 * leaving the file:
 *
 * - **Where does this go?** A function's calls, and the places that call it, on the row
 *   itself rather than in a separate panel that replaces what you were looking at.
 * - **What does this style?** A CSS rule's selector resolved against the project's markup,
 *   so `.card__title--muted` stops being a string nobody can trace and becomes three
 *   elements you can click.
 *
 * **The tree is drawn with rails, not with padding.** An outline is nested and the nesting
 * is the information; indentation alone leaves the reader counting pixels to work out
 * whether two rows are siblings. The rails are `<span>`s rather than a CSS `::before`
 * because their pattern is per-row data - which ancestors still have siblings below - and
 * that is not something a stylesheet can know.
 *
 * The reading of the file is `@adcode/structure`, which is pure and tested. This file draws
 * what that returns and owns nothing else.
 */
import {
  callsWithin,
  classifyReference,
  declarationsIn,
  describeElement,
  elementMatches,
  markupElements,
  nodeAtLine,
  outlineOf,
  outlineSupported,
  referenceGlobFor,
  referencePattern,
  searchPatternFor,
  selectorTargets,
  sortRelations,
  walkOutline,
} from "@adcode/structure";
import type { OutlineNode, RelationHit, RelationKind, SymbolKind } from "@adcode/structure";
import type { SearchHitView } from "../../shared/api.ts";
import { createIcon, iconButton } from "../workbench/icons.ts";

export interface StructureFile {
  /** Workspace-relative and forward-slashed, which is what search returns and accepts. */
  readonly relativePath: string;
  readonly languageId: string;
  readonly text: string;
}

export interface StructurePanelDeps {
  /** The file in the active tab, or null when there is none. */
  readonly activeFile: () => StructureFile | null;
  /** Put the cursor on a line in the file already open. */
  readonly reveal: (line: number, column: number) => void;
  /** Open another file and put the cursor in it. */
  readonly openAt: (relativePath: string, line: number, column: number) => void;
  readonly search: (pattern: string, include: string) => Promise<readonly SearchHitView[]>;
  readonly notify: (message: string) => void;
}

export interface StructurePanel {
  readonly element: HTMLElement;
  /** Recompute from the active file. Cheap enough to call on every save and tab change. */
  render(): void;
  /** Move the "you are here" highlight. Called as the cursor moves. */
  followCursor(line: number): void;
  /**
   * Which of the two style directions to answer.
   *
   * Both are switchable because on a project built from CSS modules or utility classes,
   * matching by name has little to say and saying it anyway is noise.
   */
  setStyleDirections(options: { elementToRules: boolean; selectorToElements: boolean }): void;
  focus(): void;
}

/**
 * A glyph per kind, drawn on the same 16×16 grid as the rest of the workbench.
 *
 * Shape carries the meaning here, not colour: the row is small, and a reader scanning for
 * "the functions" should not have to have working colour vision to find them.
 */
const KIND_ICON: Readonly<Record<SymbolKind, string>> = {
  // A rounded bracket pair - what a call looks like.
  function: "M6.2 3.5A6 6 0 0 0 6.2 12.5M9.8 3.5a6 6 0 0 1 0 9",
  method: "M6.2 3.5A6 6 0 0 0 6.2 12.5M9.8 3.5a6 6 0 0 1 0 9",
  constructor: "M8 2.5l5 3v5l-5 3-5-3v-5zM8 8v5.5",
  class: "M8 2.5l5 3v5l-5 3-5-3v-5z",
  struct: "M3 4.5h10v7H3zM3 8h10",
  interface: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M8 6.5v3",
  enum: "M4 4.5h8M4 8h8M4 11.5h8",
  namespace: "M2.5 5.5h4l1.5 2h5.5v5H2.5z",
  module: "M2.5 5.5h4l1.5 2h5.5v5H2.5z",
  variable: "M4.5 11.5l3.5-7 3.5 7",
  constant: "M4.5 8h7M4.5 5h7M4.5 11h7",
  property: "M11 5.5a2.5 2.5 0 1 1-3.6 2.2L4 11v1.5h1.5v-1.5h1.5v-1.5h1.5l.9-.9",
  type: "M4 4.5h8M8 4.5v7",
  macro: "M9 2.5L4.5 9H8l-1 4.5L11.5 7H8z",
  import: "M8 3v6M5.5 6.5L8 9l2.5-2.5M3.5 12h9",
  element: "M6.2 4L3 8l3.2 4M9.8 4L13 8l-3.2 4",
  selector: "M3 8h3.5M9.5 8H13M8 3.5v3M8 9.5v3",
  "at-rule": "M8 4.5a3.5 3.5 0 1 0 2.6 5.8M10.5 4.5v4a1.5 1.5 0 0 0 3 0 5.5 5.5 0 1 0-2.2 4.4",
  heading: "M4.5 3.5v9M11.5 3.5v9M4.5 8h7",
  key: "M10.5 4a2.5 2.5 0 1 1-2.4 3.2L4 11.3v1.2h1.4v-1.3h1.3V10h1.3l.6-.6",
};

/**
 * The relations button: one thing on the left, two on the right, arrows between.
 *
 * Symmetric about (8, 8) like every other icon in this workbench, so it is centred by
 * geometry rather than by whatever the surrounding box happens to be doing.
 */
const RELATE_ICON = [
  "M2.5 8h4M6.5 8V4.5h5M6.5 8v3.5h5",
  "M11.5 4.5l-1.6-1.4M11.5 4.5l-1.6 1.4M11.5 11.5l-1.6-1.4M11.5 11.5l-1.6 1.4",
];

/** The rail glyphs, as SVG paths on a 14×22 grid - the size of one row's rail column. */
const RAIL = {
  through: "M7 0v22",
  branch: "M7 0v11h6",
  last: "M7 0v11h6",
} as const;

const RELATION_LABEL: Readonly<Record<RelationKind, string>> = {
  definition: "Defined here",
  call: "Called from",
  reference: "Mentioned in",
  import: "Imported by",
};

/** Kinds whose relations are "what calls this", rather than "what does this style". */
const CODE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  "function", "method", "constructor", "class", "struct", "interface", "enum", "type",
  "variable", "constant", "macro", "module", "namespace", "property",
]);

/**
 * How many search hits a relations drawer will show.
 *
 * A symbol called from two hundred places is real, and a drawer with two hundred rows in it
 * is not a drawer - it is the search panel, which already exists and is better at this. The
 * count above the list is always the true one, so the cap never hides the fact that there
 * is more.
 */
const MAX_HITS = 40;

export function createStructurePanel(deps: StructurePanelDeps): StructurePanel {
  const element = document.createElement("div");
  element.className = "structure-panel";

  const summary = document.createElement("p");
  summary.className = "structure-summary";

  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "structure-filter";
  filter.placeholder = "Filter this file";
  filter.setAttribute("aria-label", "Filter the structure of this file");

  const list = document.createElement("div");
  list.className = "structure-list";
  list.setAttribute("role", "tree");

  element.append(summary, filter, list);

  let outline: readonly OutlineNode[] = [];
  let file: StructureFile | null = null;
  /** Rows keyed by `line:column`, so the cursor highlight and collapse survive a redraw. */
  const rowsByKey = new Map<string, HTMLElement>();
  const collapsed = new Set<string>();
  const openDrawers = new Set<string>();
  let currentKey: string | null = null;

  const keyOf = (node: OutlineNode): string => `${node.line}:${node.column}:${node.name}`;

  filter.addEventListener("input", () => draw());

  function render(): void {
    file = deps.activeFile();

    if (file === null) {
      outline = [];
      draw();
      return;
    }

    outline = outlineOf(file.languageId, file.text);
    draw();
  }

  /* ── Drawing ───────────────────────────────────────────────────────── */

  function draw(): void {
    list.replaceChildren();
    rowsByKey.clear();

    if (file === null) {
      summary.textContent = "";
      list.append(note("Open a file to see what is in it."));
      return;
    }

    if (!outlineSupported(file.languageId)) {
      summary.textContent = "";
      // Named rather than vague. "Unsupported" invites the reader to wonder whether they
      // did something wrong; naming the language says plainly that this is ADCode's gap.
      list.append(note(`ADCode cannot read the shape of a ${file.languageId} file yet.`));
      return;
    }

    const needle = filter.value.trim().toLowerCase();
    const total = walkOutline(outline).length;

    if (total === 0) {
      summary.textContent = "";
      list.append(note("Nothing declared in this file yet."));
      return;
    }

    summary.textContent = `${total} ${total === 1 ? "item" : "items"} in ${basename(file.relativePath)}`;

    /*
     * A filtered tree keeps a matching row's ancestors, so a method never appears without
     * the class it is in. Filtering to a flat list of matches instead would be easier and
     * would throw away the one thing this panel is for.
     */
    const visible = needle.length === 0 ? outline : filterTree(outline, needle);

    if (visible.length === 0) {
      list.append(note(`Nothing here matches "${filter.value.trim()}".`));
      return;
    }

    for (const [index, node] of visible.entries()) {
      drawNode(node, [], index === visible.length - 1, needle.length > 0);
    }

    if (currentKey !== null) highlight(currentKey);
  }

  /** `ancestors[i]` is true when that level's row still has siblings below it. */
  function drawNode(
    node: OutlineNode,
    ancestors: readonly boolean[],
    isLast: boolean,
    expandAll: boolean,
  ): void {
    const key = keyOf(node);
    const hasChildren = node.children.length > 0;
    const isCollapsed = !expandAll && collapsed.has(key);

    const row = document.createElement("div");
    row.className = "structure-row";
    row.dataset["kind"] = node.kind;
    row.setAttribute("role", "treeitem");
    row.tabIndex = -1;

    for (const [depth, continues] of ancestors.entries()) {
      row.append(rail(continues ? RAIL.through : null, `rail-${depth}`));
    }

    if (ancestors.length > 0 || !isLast || hasChildren) {
      row.append(rail(isLast ? RAIL.last : RAIL.branch, "elbow", isLast));
    }

    if (hasChildren) {
      const twisty = document.createElement("button");
      twisty.type = "button";
      twisty.className = "structure-twisty";
      twisty.setAttribute("aria-label", isCollapsed ? "Expand" : "Collapse");
      twisty.dataset["state"] = isCollapsed ? "collapsed" : "expanded";
      twisty.append(createIcon("M6 4l4 4-4 4"));

      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        draw();
      });

      row.append(twisty);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "structure-twisty structure-twisty-empty";
      row.append(spacer);
    }

    const icon = createIcon(KIND_ICON[node.kind]);
    icon.classList.add("structure-icon");
    row.append(icon);

    const name = document.createElement("span");
    name.className = "structure-name";
    name.textContent = node.name;
    row.append(name);

    if (node.detail.length > 0) {
      const detail = document.createElement("span");
      detail.className = "structure-detail";
      detail.textContent = node.detail;
      row.append(detail);
    }

    const line = document.createElement("span");
    line.className = "structure-line";
    line.textContent = String(node.line);
    row.append(line);

    // The relations control is the whole second half of this panel, so it is a real button
    // with a real label rather than a hover affordance nobody finds.
    const relations = iconButton(relationLabelFor(node), RELATE_ICON, "structure-relate");
    relations.addEventListener("click", (event) => {
      event.stopPropagation();
      void toggleDrawer(node, key, row);
    });
    row.append(relations);

    row.addEventListener("click", () => {
      deps.reveal(node.line, node.column);
      highlight(key);
    });

    rowsByKey.set(key, row);
    list.append(row);

    if (openDrawers.has(key)) void openDrawer(node, key, row);

    if (isCollapsed) return;

    const nextAncestors = [...ancestors, !isLast];
    for (const [index, child] of node.children.entries()) {
      drawNode(child, nextAncestors, index === node.children.length - 1, expandAll);
    }
  }

  function rail(path: string | null, name: string, last = false): HTMLElement {
    const cell = document.createElement("span");
    cell.className = "structure-rail";
    cell.dataset["rail"] = name;
    if (last) cell.dataset["last"] = "true";

    if (path !== null) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 14 22");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("preserveAspectRatio", "none");

      const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", path);
      svg.append(shape);
      cell.append(svg);
    }

    return cell;
  }

  function relationLabelFor(node: OutlineNode): string {
    if (node.kind === "selector") return "What does this style?";
    if (node.kind === "element") return "What styles this?";
    return `Where does ${node.name} go?`;
  }

  /* ── Relations ─────────────────────────────────────────────────────── */

  async function toggleDrawer(node: OutlineNode, key: string, row: HTMLElement): Promise<void> {
    if (openDrawers.has(key)) {
      openDrawers.delete(key);

      const drawer = row.nextElementSibling;
      if (drawer?.classList.contains("structure-drawer") === true) drawer.remove();
      return;
    }

    openDrawers.add(key);
    await openDrawer(node, key, row);
  }

  async function openDrawer(node: OutlineNode, key: string, row: HTMLElement): Promise<void> {
    const existing = row.nextElementSibling;
    if (existing?.classList.contains("structure-drawer") === true) existing.remove();

    const drawer = document.createElement("div");
    drawer.className = "structure-drawer";
    drawer.style.setProperty("--structure-depth", String(railCount(row)));
    drawer.append(note("Looking…"));
    row.after(drawer);

    const source = file;
    if (source === null) return;

    try {
      const sections =
        node.kind === "selector" || node.kind === "at-rule"
          ? selectorToElements
            ? await styleRelations(node, source)
            : [section("Off", [noteRow("Showing the elements a rule styles is switched off in Settings.")])]
          : node.kind === "element"
            ? elementToRules
              ? await elementRelations(node, source)
              : [section("Off", [noteRow("Showing the rules that style an element is switched off in Settings.")])]
            : await codeRelations(node, source);

      // The panel may have been redrawn while the search was in flight, which detaches this
      // drawer. Writing into it then is invisible work, and worse, it would leave the row's
      // spinner in place on the drawer that *is* attached.
      if (!drawer.isConnected) return;

      drawer.replaceChildren(...sections);
      if (sections.length === 0) drawer.append(note("Nothing found."));
    } catch (error) {
      if (drawer.isConnected) drawer.replaceChildren(note(describeError(error)));
    }

    if (!openDrawers.has(key)) drawer.remove();
  }

  /** How many rail cells a row has, so its drawer lines up under the name rather than the edge. */
  function railCount(row: HTMLElement): number {
    return row.querySelectorAll(".structure-rail").length;
  }

  async function codeRelations(node: OutlineNode, source: StructureFile): Promise<HTMLElement[]> {
    const sections: HTMLElement[] = [];

    if (CODE_KINDS.has(node.kind)) {
      const calls = callsWithin(source.text, node.line, node.endLine, node.name);

      if (calls.length > 0) {
        sections.push(
          section(
            `Calls ${calls.length} ${calls.length === 1 ? "thing" : "things"}`,
            calls.map((call) =>
              entry(`${call.name}()`, `line ${call.line}`, () => deps.reveal(call.line, call.column)),
            ),
          ),
        );
      }
    }

    const hits = await deps.search(referencePattern(node.name), referenceGlobFor(source.languageId));
    const classified = sortRelations(
      hits.map<RelationHit>((hit) => ({
        kind: classifyReference(node.name, source.languageId, hit.text, hit.column),
        path: hit.path,
        line: hit.line,
        column: hit.column,
        text: hit.text.trim(),
      })),
    ).filter((hit) => !(hit.kind === "definition" && hit.path === source.relativePath && hit.line === node.line));

    if (classified.length > 0) {
      sections.push(
        section(
          `${classified.length > MAX_HITS ? `${MAX_HITS} of ${classified.length}` : classified.length} elsewhere`,
          classified
            .slice(0, MAX_HITS)
            .map((hit) =>
              entry(
                `${RELATION_LABEL[hit.kind]} ${hit.path}:${hit.line}`,
                hit.text,
                () => deps.openAt(hit.path, hit.line, hit.column),
                hit.kind,
              ),
            ),
        ),
      );
    }

    if (sections.length === 0) {
      sections.push(section("Nowhere else", [noteRow(`Nothing else in the project mentions ${node.name}.`)]));
    }

    return sections;
  }

  /** A CSS rule: what it sets, and which elements it can land on. */
  async function styleRelations(node: OutlineNode, source: StructureFile): Promise<HTMLElement[]> {
    const sections: HTMLElement[] = [];

    const declarations = declarationsIn(source.text, node.line, node.endLine);
    if (declarations.length > 0) {
      sections.push(
        section(
          `Sets ${declarations.length} ${declarations.length === 1 ? "property" : "properties"}`,
          declarations.map((declaration) =>
            entry(declaration, "", () => deps.reveal(node.line + 1, 1)),
          ),
        ),
      );
    }

    const targets = selectorTargets(node.name);
    if (targets.length === 0) {
      sections.push(
        section("Applies to", [
          noteRow("This selector names no class, id or tag, so there is nothing to search for."),
        ]),
      );
      return sections;
    }

    const matches: { readonly hit: SearchHitView; readonly label: string }[] = [];
    const seen = new Set<string>();

    for (const target of targets) {
      const hits = await deps.search(searchPatternFor(target), referenceGlobFor("css"));

      for (const hit of hits) {
        /*
         * Judged element by element, on the hit's own line.
         *
         * The search only proves the *word* is on that line - it could be in a comment, in
         * a string, or in an unrelated attribute. Parsing the one line as markup and asking
         * `elementMatches` is what turns a text hit into "this element", and it is why the
         * list can be trusted enough to be worth clicking.
         */
        for (const element of markupElements(hit.text)) {
          if (!elementMatches(element, node.name)) continue;

          const key = `${hit.path}:${hit.line}:${element.column}`;
          if (seen.has(key)) continue;

          seen.add(key);
          matches.push({ hit, label: describeElement(element) });
        }
      }
    }

    sections.push(
      section(
        matches.length === 0
          ? "Applies to nothing found"
          : `Applies to ${matches.length} ${matches.length === 1 ? "element" : "elements"}`,
        matches.length === 0
          ? [
              noteRow(
                `No markup in this project has ${targets
                  .map((target) => (target.kind === "class" ? `.${target.name}` : target.kind === "id" ? `#${target.name}` : `<${target.name}>`))
                  .join(" or ")}. It may be added by script, or the rule may be dead.`,
              ),
            ]
          : matches
              .slice(0, MAX_HITS)
              .map(({ hit, label }) =>
                entry(label, `${hit.path}:${hit.line}`, () => deps.openAt(hit.path, hit.line, hit.column)),
              ),
      ),
    );

    return sections;
  }

  /**
   * The line an element's opening tag is on.
   *
   * Re-read from the buffer rather than kept on the node, because the outline stores what an
   * element *is* - its tag, id and classes, already resolved into a name - and the relations
   * view needs the attributes back to search for them.
   */
  let elementToRules = true;
  let selectorToElements = true;

  const elementSourceLine = (text: string, line: number): string => text.split("\n")[line - 1] ?? "";

  /** A markup element: which stylesheet rules can reach it. */
  async function elementRelations(node: OutlineNode, source: StructureFile): Promise<HTMLElement[]> {
    const [element] = markupElements(elementSourceLine(source.text, node.line));
    if (element === undefined) return [section("Styled by", [noteRow("Could not read this tag.")])];

    const wanted: string[] = [
      ...element.classes.map((name) => `.${name}`),
      ...(element.id === null ? [] : [`#${element.id}`]),
    ];

    if (wanted.length === 0) {
      return [
        section("Styled by", [
          noteRow(`<${element.tag}> has no class or id, so only rules for the bare tag can reach it.`),
        ]),
      ];
    }

    const rows: HTMLElement[] = [];
    const seen = new Set<string>();

    for (const target of wanted) {
      const pattern = `\\${target}\\b`;
      const hits = await deps.search(pattern, "**/*.{css,scss,less,sass}");

      for (const hit of hits.slice(0, MAX_HITS)) {
        const key = `${hit.path}:${hit.line}`;
        if (seen.has(key)) continue;

        seen.add(key);
        rows.push(
          entry(hit.text.trim(), `${hit.path}:${hit.line}`, () =>
            deps.openAt(hit.path, hit.line, hit.column),
          ),
        );
      }
    }

    return [
      section(
        rows.length === 0 ? `Nothing styles ${wanted.join(" or ")}` : `Styled by ${rows.length}`,
        rows.length === 0
          ? [noteRow(`No stylesheet in this project mentions ${wanted.join(" or ")}.`)]
          : rows,
      ),
    ];
  }

  /* ── Small parts ───────────────────────────────────────────────────── */

  function section(title: string, rows: readonly HTMLElement[]): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "structure-section";

    const heading = document.createElement("p");
    heading.className = "structure-section-title";
    heading.textContent = title;

    wrapper.append(heading, ...rows);
    return wrapper;
  }

  function entry(primary: string, secondary: string, run: () => void, kind?: RelationKind): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "structure-entry";
    if (kind !== undefined) button.dataset["relation"] = kind;

    const first = document.createElement("span");
    first.className = "structure-entry-primary";
    first.textContent = primary;
    button.append(first);

    if (secondary.length > 0) {
      const second = document.createElement("span");
      second.className = "structure-entry-secondary";
      second.textContent = secondary;
      button.append(second);
    }

    button.addEventListener("click", run);
    return button;
  }

  function note(text: string): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.className = "structure-note";
    paragraph.textContent = text;
    return paragraph;
  }

  function noteRow(text: string): HTMLElement {
    const paragraph = document.createElement("p");
    paragraph.className = "structure-note structure-note-inline";
    paragraph.textContent = text;
    return paragraph;
  }

  const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

  function describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `Could not look that up: ${message}`;
  }

  function filterTree(nodes: readonly OutlineNode[], needle: string): OutlineNode[] {
    const kept: OutlineNode[] = [];

    for (const node of nodes) {
      const children = filterTree(node.children, needle);
      const hit = node.name.toLowerCase().includes(needle);

      if (hit || children.length > 0) kept.push({ ...node, children });
    }

    return kept;
  }

  function highlight(key: string): void {
    for (const [candidate, row] of rowsByKey) {
      row.dataset["current"] = String(candidate === key);
    }
    currentKey = key;
  }

  return {
    element,
    render,

    setStyleDirections(options) {
      elementToRules = options.elementToRules;
      selectorToElements = options.selectorToElements;
    },

    followCursor(line) {
      const node = nodeAtLine(outline, line);
      if (node === null) return;

      const key = keyOf(node);
      if (key === currentKey) return;

      highlight(key);

      // Only when it is off screen. Scrolling a panel the user is reading, because their
      // cursor moved one line in a file they are not looking at, is a fight over the
      // scrollbar that the user always loses.
      const row = rowsByKey.get(key);
      if (row === undefined) return;

      const bounds = row.getBoundingClientRect();
      const view = list.getBoundingClientRect();
      if (bounds.top < view.top || bounds.bottom > view.bottom) {
        row.scrollIntoView({ block: "nearest" });
      }
    },

    focus() {
      filter.focus();
      filter.select();
    },
  };
}
