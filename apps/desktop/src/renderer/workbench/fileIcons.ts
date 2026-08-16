/**
 * File-type icons for the tree, the tabs, and quick open.
 *
 * Drawn as inline SVG rather than pulled from an icon font, for the same reason §1 keeps
 * ad assets local: a font or sprite sheet fetched at runtime is a request from the
 * editor, and the CSP forbids one. Inline paths also colour themselves from the token
 * set, so the icons follow the theme instead of fighting it.
 *
 * The shapes are deliberately a small vocabulary - a document, a braces glyph, a
 * terminal, a picture, and so on - recoloured per language. Twenty distinguishable icons
 * beat two hundred that all read as "a coloured square" at 16 pixels.
 */

type Shape =
  | "document"
  | "braces"
  | "brackets"
  | "angle"
  | "hash"
  | "terminal"
  | "image"
  | "archive"
  | "lock"
  | "gear"
  | "book"
  | "database"
  | "folder"
  | "folderOpen"
  | "git";

interface IconSpec {
  readonly shape: Shape;
  readonly colour: string;
}

/* The palette is the languages' own conventional colours, which is what makes a tree
   scannable: people recognise TypeScript blue and Python's two-tone before they read. */
const TS = "#3178c6";
const JS = "#f0db4f";
const JSON_ = "#cbcb41";
const CSS = "#42a5f5";
const HTML = "#e44d26";
const MD = "#9aa0a6";
const PY = "#3572a5";
const RS = "#dea584";
const GO = "#00add8";
const SHELL = "#89e051";
const IMAGE = "#a074c4";
const CONFIG = "#8a8a8e";
const LOCK = "#c98a3a";
const DB = "#5a9fd4";
const GIT = "#f14e32";
const RUBY = "#cc342d";
const JAVA = "#e76f00";
const C = "#5e97d0";
const PHP = "#8892bf";

const BY_EXTENSION: Readonly<Record<string, IconSpec>> = {
  ts: { shape: "braces", colour: TS },
  tsx: { shape: "angle", colour: TS },
  mts: { shape: "braces", colour: TS },
  cts: { shape: "braces", colour: TS },
  "d.ts": { shape: "braces", colour: TS },
  js: { shape: "braces", colour: JS },
  jsx: { shape: "angle", colour: JS },
  mjs: { shape: "braces", colour: JS },
  cjs: { shape: "braces", colour: JS },
  json: { shape: "brackets", colour: JSON_ },
  jsonc: { shape: "brackets", colour: JSON_ },
  css: { shape: "hash", colour: CSS },
  scss: { shape: "hash", colour: "#cd6799" },
  less: { shape: "hash", colour: "#1d365d" },
  html: { shape: "angle", colour: HTML },
  htm: { shape: "angle", colour: HTML },
  xml: { shape: "angle", colour: "#7b9e3f" },
  svg: { shape: "image", colour: "#ffb13b" },
  md: { shape: "book", colour: MD },
  markdown: { shape: "book", colour: MD },
  txt: { shape: "document", colour: MD },
  py: { shape: "braces", colour: PY },
  rs: { shape: "gear", colour: RS },
  go: { shape: "braces", colour: GO },
  rb: { shape: "braces", colour: RUBY },
  java: { shape: "braces", colour: JAVA },
  kt: { shape: "braces", colour: "#a97bff" },
  c: { shape: "braces", colour: C },
  h: { shape: "braces", colour: C },
  cpp: { shape: "braces", colour: "#9c033a" },
  cc: { shape: "braces", colour: "#9c033a" },
  hpp: { shape: "braces", colour: "#9c033a" },
  cs: { shape: "braces", colour: "#68217a" },
  php: { shape: "braces", colour: PHP },
  swift: { shape: "braces", colour: "#f05138" },
  sh: { shape: "terminal", colour: SHELL },
  bash: { shape: "terminal", colour: SHELL },
  zsh: { shape: "terminal", colour: SHELL },
  ps1: { shape: "terminal", colour: "#012456" },
  bat: { shape: "terminal", colour: CONFIG },
  cmd: { shape: "terminal", colour: CONFIG },
  yml: { shape: "gear", colour: "#cb171e" },
  yaml: { shape: "gear", colour: "#cb171e" },
  toml: { shape: "gear", colour: CONFIG },
  ini: { shape: "gear", colour: CONFIG },
  env: { shape: "lock", colour: "#e7b416" },
  sql: { shape: "database", colour: DB },
  db: { shape: "database", colour: DB },
  sqlite: { shape: "database", colour: DB },
  png: { shape: "image", colour: IMAGE },
  jpg: { shape: "image", colour: IMAGE },
  jpeg: { shape: "image", colour: IMAGE },
  gif: { shape: "image", colour: IMAGE },
  webp: { shape: "image", colour: IMAGE },
  ico: { shape: "image", colour: IMAGE },
  zip: { shape: "archive", colour: CONFIG },
  gz: { shape: "archive", colour: CONFIG },
  tar: { shape: "archive", colour: CONFIG },
  "7z": { shape: "archive", colour: CONFIG },
  pdf: { shape: "book", colour: "#e5252a" },
  lock: { shape: "lock", colour: LOCK },
};

/** Whole filenames that mean more than their extension does. */
const BY_NAME: Readonly<Record<string, IconSpec>> = {
  "package.json": { shape: "brackets", colour: "#8bc500" },
  "package-lock.json": { shape: "lock", colour: LOCK },
  "tsconfig.json": { shape: "gear", colour: TS },
  ".gitignore": { shape: "git", colour: GIT },
  ".gitattributes": { shape: "git", colour: GIT },
  ".gitmodules": { shape: "git", colour: GIT },
  dockerfile: { shape: "gear", colour: "#2496ed" },
  makefile: { shape: "gear", colour: CONFIG },
  "readme.md": { shape: "book", colour: "#42a5f5" },
  license: { shape: "book", colour: LOCK },
  ".env": { shape: "lock", colour: "#e7b416" },
};

const DEFAULT: IconSpec = { shape: "document", colour: "#8a8a8e" };

/* SVG path data on a 16x16 grid. Stroked, not filled, so one shape reads at any size. */
const SHAPES: Readonly<Record<Shape, string>> = {
  document: "M4 2h5l3 3v9H4z M9 2v3h3",
  braces: "M6.5 2.5C5 2.5 5 5 5 6.2 5 7.4 3.5 8 3.5 8S5 8.6 5 9.8c0 1.2 0 3.7 1.5 3.7 M9.5 2.5C11 2.5 11 5 11 6.2c0 1.2 1.5 1.8 1.5 1.8S11 8.6 11 9.8c0 1.2 0 3.7-1.5 3.7",
  brackets: "M6.5 2.5H4.5v11h2 M9.5 2.5h2v11h-2",
  angle: "M6 5L2.5 8 6 11 M10 5l3.5 3-3.5 3",
  hash: "M6 2.5L4.5 13.5 M11 2.5L9.5 13.5 M2.5 5.5h11 M2.5 10.5h11",
  terminal: "M2.5 2.5h11v11h-11z M5 6l2 2-2 2 M8.5 10.5h3",
  image: "M2.5 3.5h11v9h-11z M2.5 10l3-3 3 3 2-2 3 3",
  archive: "M2.5 3.5h11v10h-11z M2.5 6.5h11 M7 3.5v3 M9 3.5v3 M8 9v2",
  lock: "M4 7.5h8v6H4z M5.8 7.5V5.4a2.2 2.2 0 0 1 4.4 0v2.1",
  gear: "M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8 M8 1.8v1.8 M8 12.4v1.8 M1.8 8h1.8 M12.4 8h1.8 M3.6 3.6l1.3 1.3 M11.1 11.1l1.3 1.3 M12.4 3.6l-1.3 1.3 M4.9 11.1l-1.3 1.3",
  book: "M3 2.5h6.5a2 2 0 0 1 2 2v9H5a2 2 0 0 0-2 2z M11.5 4.5H13v9",
  database: "M8 2.2c3 0 5 .8 5 1.8s-2 1.8-5 1.8S3 5 3 4s2-1.8 5-1.8z M3 4v8c0 1 2 1.8 5 1.8s5-.8 5-1.8V4 M3 8c0 1 2 1.8 5 1.8s5-.8 5-1.8",
  folder: "M2 4.5a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z",
  folderOpen: "M2 12.5v-8a1 1 0 0 1 1-1h3l1.5 2H12a1 1 0 0 1 1 1v1 M2 12.5l2-5h10.5l-2 5z",
  git: "M8 1.8 1.8 8 8 14.2 14.2 8z M6.4 8h3.2 M8 6.4v3.2",
};

/** The icon for a filename, as an `<svg>` ready to insert. */
export function fileIcon(filename: string): SVGElement {
  return render(specFor(filename));
}

/** The icon for a directory. */
export function folderIcon(open: boolean): SVGElement {
  return render({ shape: open ? "folderOpen" : "folder", colour: "#79b8ff" });
}

function specFor(filename: string): IconSpec {
  const lower = filename.toLowerCase();

  const byName = BY_NAME[lower];
  if (byName !== undefined) return byName;

  // `.d.ts` and `.tar.gz` carry more meaning than their last segment does, so the two
  // longest suffixes are tried before the plain extension.
  const parts = lower.split(".");
  if (parts.length > 2) {
    const compound = BY_EXTENSION[parts.slice(-2).join(".")];
    if (compound !== undefined) return compound;
  }

  // A dotfile with no extension - `.gitignore` handled above, `.npmrc` here.
  if (lower.startsWith(".") && parts.length === 2) {
    return BY_EXTENSION[parts[1] ?? ""] ?? { shape: "gear", colour: CONFIG };
  }

  return BY_EXTENSION[parts.at(-1) ?? ""] ?? DEFAULT;
}

function render(spec: IconSpec): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "file-icon");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SHAPES[spec.shape]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", spec.colour);
  path.setAttribute("stroke-width", "1.3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.append(path);
  return svg;
}
