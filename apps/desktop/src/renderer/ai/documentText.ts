/**
 * The words inside documents a model cannot open: Word, Excel, PowerPoint, OpenDocument and PDF.
 *
 * Every provider ADCode talks to - and every coding CLI - reads text, but few read a .docx, and
 * none of the CLIs takes a PDF. So a document is turned into text here, in the renderer, and it
 * travels as a text attachment like any pasted log: the main process never parses a file, and a
 * hostile document is opened only in the sandboxed window.
 *
 * Office files are ZIP archives of XML. The archive is read with the platform's own
 * DecompressionStream and the XML with a small tag walker, so no parser library comes along -
 * a few hundred lines that do one job instead of a dependency that does every job. PDFs need a
 * real reader (pdfReader.ts loads PDF.js on demand); `pdfDocumentText` here only arranges what
 * it hands back, so the arranging is tested without a window.
 *
 * Limits, stated rather than hidden: pictures, charts and layout are not read; a scanned PDF has
 * no text to give; old binary .doc, .xls and .ppt files are refused with the format to save as.
 */

/** A document this big is refused before it is read. Only its text is sent, so this is generous. */
export const MAX_DOCUMENT_BYTES = 25_000_000;
/** One file inside an Office archive, unpacked. Past it the archive is refused (a zip bomb, or a huge sheet). */
const MAX_UNPACKED_ENTRY = 64_000_000;

export type DocumentFormat = "pdf" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp";

const EXTENSIONS: Readonly<Record<string, DocumentFormat>> = {
  pdf: "pdf", docx: "docx", docm: "docx", xlsx: "xlsx", xlsm: "xlsx", pptx: "pptx", pptm: "pptx",
  odt: "odt", ods: "ods", odp: "odp",
};

const MIME_TYPES: Readonly<Record<string, DocumentFormat>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
};

const LABELS: Readonly<Record<DocumentFormat, string>> = {
  pdf: "PDF", docx: "Word document", xlsx: "Excel workbook", pptx: "PowerPoint deck",
  odt: "OpenDocument text", ods: "OpenDocument spreadsheet", odp: "OpenDocument presentation",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Which document this is, by MIME type or extension, or null when it is not one this module reads. */
export function documentFormat(name: string, mime: string): DocumentFormat | null {
  return MIME_TYPES[mime] ?? EXTENSIONS[extensionOf(name)] ?? null;
}

/** The chip's word for it, short enough to leave room for "12 pages · 2.4 MB". */
const CHIP_LABELS: Readonly<Record<DocumentFormat, string>> = {
  pdf: "PDF", docx: "Word", xlsx: "Excel", pptx: "PowerPoint", odt: "OpenDocument", ods: "OpenDocument", odp: "OpenDocument",
};

export function documentLabel(format: DocumentFormat): string {
  return LABELS[format];
}

/** What was read, ready for the chat: the text, and a few words for the chip ("12 pages"). */
export interface ExtractedDocument {
  readonly text: string;
  readonly detail: string;
}

/** A refusal whose message is a sentence for the person, naming the file. */
export class DocumentError extends Error {
  override readonly name = "DocumentError";
}

/* ── ZIP ──────────────────────────────────────────────────────────────────── */

interface ZipEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly headerOffset: number;
}

export interface ZipArchive {
  has(path: string): boolean;
  /** The entry as UTF-8 text, or null when the archive has no such entry. */
  text(path: string): Promise<string | null>;
  readonly paths: readonly string[];
}

/** Reads the archive's directory. Throws for anything that is not a plain ZIP. */
export function openZip(bytes: Uint8Array, name: string): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const broken = (): DocumentError => new DocumentError(`${name} could not be opened - the file looks damaged. Open it and save it again, then attach it.`);
  // The end-of-directory record sits in the last 64 KB (plus its own 22 bytes).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end === -1) throw broken();
  const count = view.getUint16(end + 10, true);
  const directory = view.getUint32(end + 16, true);
  if (count === 0xffff || directory === 0xffffffff) throw new DocumentError(`${name} is too large to read here. Save the part you need as a smaller file.`);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");
  let at = directory;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw broken();
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if ((flags & 1) === 1) throw new DocumentError(`${name} is password-protected. Remove the password, or copy the text into the chat.`);
    entries.set(path, {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      headerOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }

  async function unpack(entry: ZipEntry): Promise<Uint8Array> {
    const header = entry.headerOffset;
    if (header + 30 > bytes.length || view.getUint32(header, true) !== 0x04034b50) throw broken();
    const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw broken();
    if (entry.size > MAX_UNPACKED_ENTRY) throw new DocumentError(`${name} holds more than this can read at once. Save the part you need as a smaller file.`);
    // Counted as it unpacks: the size in the directory is the archive's claim, not a promise.
    const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => { throw broken(); });
      if (done) break;
      total += value.length;
      if (total > MAX_UNPACKED_ENTRY) {
        await reader.cancel().catch(() => undefined);
        throw new DocumentError(`${name} holds more than this can read at once. Save the part you need as a smaller file.`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  }

  return {
    paths: [...entries.keys()],
    has: (path) => entries.has(path),
    async text(path) {
      const entry = entries.get(path);
      return entry === undefined ? null : decoder.decode(await unpack(entry));
    },
  };
}

/* ── XML ──────────────────────────────────────────────────────────────────── */

export type XmlEvent =
  | { readonly type: "open"; readonly name: string; readonly attrs: string; readonly empty: boolean }
  | { readonly type: "close"; readonly name: string }
  | { readonly type: "text"; readonly text: string };

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return safeCodePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
    if (body.startsWith("#")) return safeCodePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
    return ENTITIES[body] ?? whole;
  });
}

function safeCodePoint(code: number): string | null {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

/** Tags and text in document order. Comments, declarations and processing instructions are skipped. */
export function* xmlEvents(xml: string): Generator<XmlEvent> {
  const pattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/)?([^\s/>!?]+)([^>]*?)(\/)?>|([^<]+)/g;
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    const [, cdata, closing, name, attrs, empty, text] = match;
    if (cdata !== undefined) yield { type: "text", text: cdata };
    else if (text !== undefined) yield { type: "text", text: decodeEntities(text) };
    else if (name !== undefined) {
      if (closing !== undefined) yield { type: "close", name };
      else yield { type: "open", name, attrs: attrs ?? "", empty: empty !== undefined };
    }
  }
}

/** One attribute's value from a tag's attribute text, or null. */
export function attribute(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return match === null ? null : decodeEntities(match[1] ?? match[2] ?? "");
}

/* ── Building the text ────────────────────────────────────────────────────── */

/** A CSV row: cells quoted when they hold a comma, a quote or a line break. */
export function csvRow(cells: readonly string[]): string {
  return cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll("\"", "\"\"")}"` : cell)).join(",");
}

/** Repeated rows and cells (OpenDocument's way of saying "the next 1,000 are the same") stop here. */
const MAX_REPEAT = 50;

/**
 * Paragraphs and tables into lines. A table's rows become CSV (spreadsheets) or `a | b` (tables
 * inside text), and a table inside a table is read as words in its cell.
 */
class TextBuilder {
  private readonly lines: string[] = [];
  private length = 0;
  private paragraph = "";
  private row: string[] | null = null;
  private cell: string | null = null;
  private tableDepth = 0;
  private readonly maxChars: number;
  private readonly tables: "csv" | "pipes";

  constructor(maxChars: number, tables: "csv" | "pipes") {
    this.maxChars = maxChars;
    this.tables = tables;
  }

  /** True once enough text is in: the walkers stop reading. */
  get full(): boolean {
    return this.length >= this.maxChars;
  }

  text(words: string): void {
    if (this.cell !== null) this.cell += words;
    else this.paragraph += words;
  }

  paragraphEnd(): void {
    if (this.cell !== null) { this.cell += "\n"; return; }
    this.push(this.paragraph.replace(/[ \t]+$/g, ""));
    this.paragraph = "";
  }

  heading(title: string): void {
    this.flushParagraph();
    if (this.lines.length > 0) this.push("");
    this.push(`## ${title}`);
  }

  tableStart(): void {
    this.tableDepth += 1;
    if (this.tableDepth === 1) this.flushParagraph();
  }

  tableEnd(): void {
    this.tableDepth = Math.max(0, this.tableDepth - 1);
  }

  rowStart(): void {
    if (this.tableDepth <= 1) this.row = [];
  }

  cellStart(): void {
    if (this.tableDepth <= 1 && this.row !== null) this.cell = "";
    else if (this.cell !== null) this.cell += " ";
  }

  cellEnd(repeat = 1): void {
    if (this.tableDepth > 1 || this.row === null || this.cell === null) return;
    const value = this.cell.trim();
    const times = value === "" ? Math.min(repeat, 16_384) : Math.min(repeat, MAX_REPEAT);
    for (let index = 0; index < times; index += 1) this.row.push(value);
    this.cell = null;
  }

  rowEnd(repeat = 1): void {
    if (this.tableDepth > 1 || this.row === null) return;
    const cells = this.row;
    this.row = null;
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) return;
    const line = this.tables === "csv" ? csvRow(cells) : cells.map((cell) => cell.replace(/\s+/g, " ")).join(" | ");
    for (let index = 0; index < Math.min(repeat, MAX_REPEAT); index += 1) this.push(line);
  }

  /** A whole line from outside the paragraph model: a spreadsheet's CSV row. */
  line(text: string): void {
    this.flushParagraph();
    this.push(text);
  }

  done(): string {
    this.flushParagraph();
    return this.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private flushParagraph(): void {
    if (this.paragraph.trim() !== "") this.push(this.paragraph.trimEnd());
    this.paragraph = "";
  }

  private push(line: string): void {
    this.lines.push(line);
    this.length += line.length + 1;
  }
}

/* ── Word ─────────────────────────────────────────────────────────────────── */

export function docxText(xml: string, maxChars: number): string {
  const out = new TextBuilder(maxChars, "pipes");
  let inText = false;
  // A text box is written twice - the modern shape and an old-style fallback - and read once.
  let fallback = 0;
  for (const event of xmlEvents(xml)) {
    if (out.full) break;
    if (event.type === "open" && event.name === "mc:Fallback" && !event.empty) { fallback += 1; continue; }
    if (event.type === "close" && event.name === "mc:Fallback") { fallback = Math.max(0, fallback - 1); continue; }
    if (fallback > 0) continue;
    if (event.type === "text") { if (inText) out.text(event.text); continue; }
    if (event.type === "open") {
      switch (event.name) {
        case "w:t": inText = !event.empty; break;
        case "w:tab": out.text("\t"); break;
        case "w:br": case "w:cr": out.text("\n"); break;
        case "w:noBreakHyphen": out.text("-"); break;
        case "w:tbl": out.tableStart(); break;
        case "w:tr": out.rowStart(); break;
        case "w:tc": out.cellStart(); break;
        default: break;
      }
      continue;
    }
    switch (event.name) {
      case "w:t": inText = false; break;
      case "w:p": out.paragraphEnd(); break;
      case "w:tc": out.cellEnd(); break;
      case "w:tr": out.rowEnd(); break;
      case "w:tbl": out.tableEnd(); break;
      default: break;
    }
  }
  return out.done();
}

/* ── Relationships, shared by Excel and PowerPoint ───────────────────────── */

/** `_rels` targets by id, resolved to archive paths against the folder of the part they belong to. */
export function relationships(xml: string | null, folder: string): Map<string, string> {
  const targets = new Map<string, string>();
  if (xml === null) return targets;
  for (const event of xmlEvents(xml)) {
    if (event.type !== "open" || event.name !== "Relationship") continue;
    const id = attribute(event.attrs, "Id");
    const target = attribute(event.attrs, "Target");
    if (id === null || target === null || attribute(event.attrs, "TargetMode") === "External") continue;
    targets.set(id, resolvePart(folder, target));
  }
  return targets;
}

function resolvePart(folder: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${folder}/${target}`).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

/* ── Excel ────────────────────────────────────────────────────────────────── */

/** Built-in number formats that are dates or times (ECMA-376 §18.8.30, plus the CJK date ids). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** A custom number format that shows a date or a time: d, m, y, h or s outside quotes and colours. */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** An Excel serial date as text: 2026-11-26, 2026-11-26 14:30, or 14:30 for a time alone. */
export function excelDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const when = new Date(epoch + Math.round(serial * 86_400) * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const time = `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}${when.getUTCSeconds() === 0 ? "" : `:${pad(when.getUTCSeconds())}`}`;
  if (serial < 1 && serial >= 0) return time;
  const date = `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}`;
  return Number.isInteger(serial) ? date : `${date} ${time}`;
}

export function sharedStrings(xml: string | null): string[] {
  if (xml === null) return [];
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  for (const event of xmlEvents(xml)) {
    if (event.type === "text") { if (inText && phonetic === 0 && current !== null) current += event.text; continue; }
    if (event.type === "open") {
      if (event.name === "si") current = event.empty ? null : "";
      else if (event.name === "rPh") phonetic += event.empty ? 0 : 1;
      else if (event.name === "t") inText = !event.empty;
      if (event.name === "si" && event.empty) strings.push("");
      continue;
    }
    if (event.name === "t") inText = false;
    else if (event.name === "rPh") phonetic = Math.max(0, phonetic - 1);
    else if (event.name === "si") { strings.push(current ?? ""); current = null; }
  }
  return strings;
}

/** Which cell styles show dates: index into `cellXfs` -> true. */
export function dateStyles(xml: string | null): boolean[] {
  if (xml === null) return [];
  const custom = new Map<number, string>();
  const styles: boolean[] = [];
  let inCellXfs = false;
  for (const event of xmlEvents(xml)) {
    if (event.type === "text") continue;
    if (event.type === "close") { if (event.name === "cellXfs") inCellXfs = false; continue; }
    if (event.name === "numFmt") {
      const id = Number(attribute(event.attrs, "numFmtId"));
      const code = attribute(event.attrs, "formatCode");
      if (Number.isInteger(id) && code !== null) custom.set(id, code);
    } else if (event.name === "cellXfs") {
      inCellXfs = !event.empty;
    } else if (event.name === "xf" && inCellXfs) {
      const id = Number(attribute(event.attrs, "numFmtId") ?? "0");
      const code = custom.get(id);
      styles.push(code === undefined ? DATE_FORMAT_IDS.has(id) : isDateFormat(code));
    }
  }
  return styles;
}

/** "BC12" -> 54 (zero-based column). */
function columnIndex(reference: string): number | null {
  const letters = /^[A-Z]+/i.exec(reference)?.[0];
  if (letters === undefined) return null;
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export interface SheetContext {
  readonly strings: readonly string[];
  readonly dates: readonly boolean[];
  readonly date1904: boolean;
}

/** One worksheet's rows as CSV lines, empty rows left out, the way the cells read in Excel. */
export function sheetRows(xml: string, context: SheetContext, emit: (line: string) => boolean): void {
  let row: string[] = [];
  let column = 0;
  let type = "n";
  let style = 0;
  let value = "";
  let inline = "";
  let capture: "v" | "t" | null = null;
  const finishCell = (): void => {
    let shown: string;
    if (type === "s") shown = context.strings[Number(value)] ?? "";
    else if (type === "inlineStr") shown = inline;
    else if (type === "b") shown = value === "1" ? "TRUE" : value === "0" ? "FALSE" : value;
    else if ((type === "n" || type === "") && value !== "" && context.dates[style] === true && Number.isFinite(Number(value))) shown = excelDate(Number(value), context.date1904);
    else shown = value;
    while (row.length < column) row.push("");
    row[column] = shown;
  };
  for (const event of xmlEvents(xml)) {
    if (event.type === "text") {
      if (capture === "v") value += event.text;
      else if (capture === "t") inline += event.text;
      continue;
    }
    if (event.type === "open") {
      if (event.name === "row") { row = []; column = 0; if (event.empty) row = []; }
      else if (event.name === "c") {
        const reference = attribute(event.attrs, "r");
        const at = reference === null ? null : columnIndex(reference);
        column = at ?? row.length;
        type = attribute(event.attrs, "t") ?? "n";
        style = Number(attribute(event.attrs, "s") ?? "0");
        value = "";
        inline = "";
        if (event.empty) finishCell();
      } else if (event.name === "v" && !event.empty) capture = "v";
      else if (event.name === "t" && !event.empty) capture = "t";
      continue;
    }
    if (event.name === "v" || event.name === "t") capture = null;
    else if (event.name === "c") finishCell();
    else if (event.name === "row") {
      while (row.length > 0 && row[row.length - 1] === "") row.pop();
      if (row.length > 0 && !emit(csvRow(row))) return;
      row = [];
    }
  }
}

async function xlsxText(zip: ZipArchive, maxChars: number): Promise<ExtractedDocument> {
  const workbook = (await zip.text("xl/workbook.xml")) ?? "";
  const links = relationships(await zip.text("xl/_rels/workbook.xml.rels"), "xl");
  const sheets: { name: string; path: string }[] = [];
  let date1904 = false;
  for (const event of xmlEvents(workbook)) {
    if (event.type !== "open") continue;
    if (event.name === "workbookPr") date1904 = /^(1|true)$/i.test(attribute(event.attrs, "date1904") ?? "");
    if (event.name !== "sheet") continue;
    const id = attribute(event.attrs, "r:id");
    const path = id === null ? undefined : links.get(id);
    if (path !== undefined && zip.has(path)) sheets.push({ name: attribute(event.attrs, "name") ?? `Sheet ${sheets.length + 1}`, path });
  }
  const context: SheetContext = {
    strings: sharedStrings(await zip.text("xl/sharedStrings.xml")),
    dates: dateStyles(await zip.text("xl/styles.xml")),
    date1904,
  };
  const out = new TextBuilder(maxChars, "csv");
  let read = 0;
  for (const sheet of sheets) {
    if (out.full) break;
    out.heading(`Sheet: ${sheet.name}`);
    sheetRows((await zip.text(sheet.path)) ?? "", context, (line) => { out.line(line); return !out.full; });
    read += 1;
  }
  const count = sheets.length;
  return {
    text: out.done(),
    detail: read < count ? `${read} of ${count} sheets` : `${count} sheet${count === 1 ? "" : "s"}`,
  };
}

/* ── PowerPoint ───────────────────────────────────────────────────────────── */

export function slideText(xml: string): string {
  const out = new TextBuilder(Number.POSITIVE_INFINITY, "pipes");
  let inText = false;
  for (const event of xmlEvents(xml)) {
    if (event.type === "text") { if (inText) out.text(event.text); continue; }
    if (event.type === "open") {
      if (event.name === "a:t") inText = !event.empty;
      else if (event.name === "a:br") out.text("\n");
      else if (event.name === "a:tbl") out.tableStart();
      else if (event.name === "a:tr") out.rowStart();
      else if (event.name === "a:tc") out.cellStart();
      continue;
    }
    if (event.name === "a:t") inText = false;
    else if (event.name === "a:p") out.paragraphEnd();
    else if (event.name === "a:tc") out.cellEnd();
    else if (event.name === "a:tr") out.rowEnd();
    else if (event.name === "a:tbl") out.tableEnd();
  }
  return out.done();
}

async function pptxText(zip: ZipArchive, maxChars: number): Promise<ExtractedDocument> {
  const links = relationships(await zip.text("ppt/_rels/presentation.xml.rels"), "ppt");
  const ordered: string[] = [];
  for (const event of xmlEvents((await zip.text("ppt/presentation.xml")) ?? "")) {
    if (event.type !== "open" || event.name !== "p:sldId") continue;
    const path = links.get(attribute(event.attrs, "r:id") ?? "");
    if (path !== undefined && zip.has(path)) ordered.push(path);
  }
  // No list in the deck: the slide files in number order.
  const slides = ordered.length > 0 ? ordered : zip.paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(/\d+/.exec(a.slice(11))?.[0]) - Number(/\d+/.exec(b.slice(11))?.[0]));
  const out = new TextBuilder(maxChars, "pipes");
  let read = 0;
  for (const path of slides) {
    if (out.full) break;
    out.heading(`Slide ${read + 1}`);
    for (const line of slideText((await zip.text(path)) ?? "").split("\n")) out.line(line);
    read += 1;
  }
  return { text: out.done(), detail: read < slides.length ? `${read} of ${slides.length} slides` : `${slides.length} slide${slides.length === 1 ? "" : "s"}` };
}

/* ── OpenDocument ─────────────────────────────────────────────────────────── */

export function openDocumentText(xml: string, format: "odt" | "ods" | "odp", maxChars: number): { text: string; parts: number } {
  const out = new TextBuilder(maxChars, format === "ods" ? "csv" : "pipes");
  let inBody = false;
  let paragraphs = 0;
  let parts = 0;
  const repeat = (attrs: string, name: string): number => Math.max(1, Number(attribute(attrs, name) ?? "1") || 1);
  const rowRepeats: number[] = [];
  const cellRepeats: number[] = [];
  for (const event of xmlEvents(xml)) {
    if (out.full) break;
    if (event.type === "text") { if (inBody && paragraphs > 0) out.text(event.text); continue; }
    if (event.type === "open") {
      switch (event.name) {
        case "office:body": inBody = true; break;
        case "text:p": case "text:h": if (!event.empty) paragraphs += 1; else out.paragraphEnd(); break;
        case "text:tab": out.text("\t"); break;
        case "text:line-break": out.text("\n"); break;
        case "text:s": out.text(" ".repeat(Math.min(repeat(event.attrs, "text:c"), 200))); break;
        case "table:table":
          if (format === "ods" && !event.empty) { parts += 1; out.heading(`Sheet: ${attribute(event.attrs, "table:name") ?? parts}`); }
          out.tableStart();
          if (event.empty) out.tableEnd();
          break;
        case "table:table-row":
          out.rowStart();
          rowRepeats.push(repeat(event.attrs, "table:number-rows-repeated"));
          if (event.empty) out.rowEnd(rowRepeats.pop());
          break;
        case "table:table-cell": case "table:covered-table-cell":
          out.cellStart();
          cellRepeats.push(repeat(event.attrs, "table:number-columns-repeated"));
          if (event.empty) out.cellEnd(cellRepeats.pop());
          break;
        case "draw:page": parts += 1; out.heading(`Slide ${parts}`); break;
        default: break;
      }
      continue;
    }
    switch (event.name) {
      case "office:body": inBody = false; break;
      case "text:p": case "text:h": paragraphs = Math.max(0, paragraphs - 1); out.paragraphEnd(); break;
      case "table:table": out.tableEnd(); break;
      case "table:table-row": out.rowEnd(rowRepeats.pop()); break;
      case "table:table-cell": case "table:covered-table-cell": out.cellEnd(cellRepeats.pop()); break;
      default: break;
    }
  }
  return { text: out.done(), parts };
}

/* ── PDF ──────────────────────────────────────────────────────────────────── */

/** The slice of a PDF.js document this needs, so tests hand in the real one or a fake. */
export interface PdfLike {
  readonly numPages: number;
  getPage(number: number): Promise<{ getTextContent(): Promise<{ readonly items: readonly unknown[] }> }>;
  /** Frees the reader's copy of the file. */
  destroy?(): Promise<unknown>;
}

/** Each page's words in reading order, page by page, until there is enough. */
export async function pdfDocumentText(pdf: PdfLike, name: string, maxChars: number): Promise<ExtractedDocument> {
  const pages: string[] = [];
  let length = 0;
  let read = 0;
  for (let number = 1; number <= pdf.numPages && length < maxChars; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    let page = "";
    for (const item of content.items) {
      if (typeof item !== "object" || item === null || !("str" in item)) continue;
      const { str, hasEOL } = item as { str: unknown; hasEOL?: unknown };
      if (typeof str === "string") page += str;
      if (hasEOL === true) page += "\n";
    }
    const text = page.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    pages.push(`--- Page ${number} ---\n${text}`);
    length += text.length;
    read += 1;
  }
  if (length < 20) {
    throw new DocumentError(`${name} has no text to read - it looks like scanned pages. Attach screenshots of the pages instead, so the model can look at them.`);
  }
  const total = pdf.numPages;
  return { text: pages.join("\n\n"), detail: read < total ? `${read} of ${total} pages` : `${total} page${total === 1 ? "" : "s"}` };
}

/* ── One entry point ──────────────────────────────────────────────────────── */

/**
 * The document's text, with a line in front saying what it is and what was left out, so the
 * model never mistakes a reading for the file itself. `readPdf` is PDF.js, loaded by the caller.
 */
export async function extractDocument(
  format: DocumentFormat,
  name: string,
  bytes: Uint8Array,
  maxChars: number,
  readPdf: (bytes: Uint8Array) => Promise<PdfLike>,
): Promise<ExtractedDocument> {
  let read: ExtractedDocument;
  if (format === "pdf") {
    const pdf = await readPdf(bytes);
    try {
      read = await pdfDocumentText(pdf, name, maxChars);
    } finally {
      void pdf.destroy?.().catch(() => undefined);
    }
  } else if (format === "docx") {
    const zip = openZip(bytes, name);
    const body = await zip.text("word/document.xml");
    if (body === null) throw new DocumentError(`${name} is not a Word document this can read. Open it in Word and save it as .docx again.`);
    read = { text: docxText(body, maxChars), detail: "" };
  } else if (format === "xlsx") {
    read = await xlsxText(openZip(bytes, name), maxChars);
  } else if (format === "pptx") {
    read = await pptxText(openZip(bytes, name), maxChars);
  } else {
    const content = await openZip(bytes, name).text("content.xml");
    if (content === null) throw new DocumentError(`${name} is not an OpenDocument file this can read. Open it and save it again.`);
    const { text, parts } = openDocumentText(content, format, maxChars);
    const unit = format === "ods" ? "sheet" : format === "odp" ? "slide" : "";
    read = { text, detail: unit === "" ? "" : `${parts} ${unit}${parts === 1 ? "" : "s"}` };
  }
  if (read.text.trim() === "") {
    throw new DocumentError(`${name} has no text in it to read.`);
  }
  const what = [documentLabel(format), read.detail].filter((part) => part !== "").join(", ");
  return {
    text: `[Text read from ${name} (${what}). Pictures, charts and layout are not included.]\n\n${read.text}`,
    detail: read.detail === "" ? CHIP_LABELS[format] : `${CHIP_LABELS[format]} · ${read.detail}`,
  };
}
