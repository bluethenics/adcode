/**
 * Files into assistant turns: picker, drag-drop, paste and the right-click Paste all land here.
 *
 * Two kinds leave this module. Images (screenshots, mockups, whiteboard photos)
 * travel as base64 for the provider adapters; everything else travels as text so the
 * main process never reads the user's disk for them, and every model - and every coding
 * CLI - can read it. Text and code files go as they are. PDF, Word, Excel, PowerPoint and
 * OpenDocument files go as the text read out of them (documentText.ts). A file with an
 * extension this does not know is looked at: if its bytes are text, it goes as text.
 * Video, audio, archives and old binary Office files are refused with a sentence that
 * says what to do instead.
 *
 * DOM lives at the edges (`fileToAttachment` reads Blobs, `downscaleImage` paints
 * a canvas). Everything that decides - classification, limits, truncation - is pure
 * and tested without a window.
 */
import { documentFormat, extractDocument, DocumentError, MAX_DOCUMENT_BYTES, type PdfLike } from "./documentText.ts";
import { pdfOpener } from "./pdfReader.ts";

export type AttachmentKind = "image" | "text";

export interface PendingAttachment {
  readonly id: string;
  readonly name: string;
  readonly kind: AttachmentKind;
  /** MIME type: an image/* value for images, best-effort for text. */
  readonly mediaType: string;
  /** Raw file bytes, for the chip label. */
  readonly size: number;
  /** Data-URL preview for images, "" for documents. Dropped with the chip. */
  readonly previewUrl: string;
  /** The IPC payload: base64 for images, raw text for documents. */
  readonly data: string;
  /** What the chip says the file was read as, such as "PDF · 12 pages". */
  readonly detail?: string;
}

/** A file-like without requiring the DOM's `File` - tests hand in fakes. */
export interface AttachmentSource {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 12_000_000;
export const MAX_TEXT_CHARS = 50_000;
/** Longest side after downscaling; matches what providers downsample to anyway. */
export const MAX_IMAGE_SIDE = 1568;

/** The picture types every provider takes as they are. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Pictures the window can draw but providers do not take: redrawn as PNG. */
const CONVERTED_IMAGE_TYPES = new Set(["image/bmp", "image/x-ms-bmp", "image/x-icon", "image/vnd.microsoft.icon", "image/avif"]);
const CONVERTED_IMAGE_EXTENSIONS = new Set(["bmp", "ico", "avif"]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "rst", "adoc", "json", "jsonc", "json5", "csv", "tsv", "log",
  "yaml", "yml", "xml", "toml", "ini", "cfg", "conf", "env", "properties", "sh", "bash", "zsh", "fish",
  "ps1", "psm1", "bat", "cmd", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "py", "java",
  "c", "h", "cpp", "hpp", "cc", "cs", "fs", "rs", "go", "rb", "php", "swift", "kt", "kts", "scala",
  "dart", "lua", "r", "pl", "ex", "exs", "erl", "hs", "clj", "sql", "graphql", "gql", "proto",
  "css", "scss", "sass", "less", "html", "htm", "svg", "vue", "svelte", "astro", "tf", "hcl",
  "gradle", "dockerfile", "makefile", "cmake", "diff", "patch", "srt", "vtt", "ipynb", "rtf", "tex",
]);

/** Kinds this refuses outright, each with what to do instead. */
const REFUSED: readonly { readonly test: (extension: string, mime: string) => boolean; readonly reason: (name: string) => string }[] = [
  { test: (extension) => extension === "doc" || extension === "dot", reason: (name) => `${name}: old Word files (.doc) can't be read. Open it in Word, save it as .docx, and attach that.` },
  { test: (extension) => extension === "xls" || extension === "xlt", reason: (name) => `${name}: old Excel files (.xls) can't be read. Open it in Excel, save it as .xlsx or .csv, and attach that.` },
  { test: (extension) => extension === "ppt" || extension === "pps", reason: (name) => `${name}: old PowerPoint files (.ppt) can't be read. Open it in PowerPoint, save it as .pptx, and attach that.` },
  { test: (extension, mime) => mime.startsWith("video/") || mime.startsWith("audio/") || ["mp4", "mov", "avi", "mkv", "webm", "mp3", "wav", "m4a", "flac", "ogg"].includes(extension), reason: (name) => `${name}: video and audio can't be attached. Attach a screenshot, or describe what happens in it.` },
  { test: (extension) => ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(extension), reason: (name) => `${name}: unpack the archive first and attach the files inside.` },
  { test: (extension, mime) => ["heic", "heif", "tif", "tiff", "psd", "raw", "cr2", "nef"].includes(extension) || mime === "image/heic" || mime === "image/tiff", reason: (name) => `${name}: that picture format can't be read here. Save it as PNG or JPEG and attach that.` },
  { test: (extension) => ["exe", "dll", "msi", "dmg", "app", "so", "dylib", "bin", "iso", "apk"].includes(extension), reason: (name) => `${name}: programs and disk images can't be attached.` },
];

/**
 * "sniff": an extension this does not know. Its bytes decide - text goes as text, anything
 * else is refused - so a .vue, .env or Dockerfile is not turned away for its name.
 */
export type FileKind = "image" | "text" | "document" | "sniff" | "unsupported";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // A dotless name like Dockerfile or Makefile is its own extension.
  return (dot === -1 ? name : name.slice(dot + 1)).toLowerCase();
}

/**
 * Image by MIME, text by MIME or extension, documents by either. The OS often
 * reports no MIME at all (markdown arrives as ""), so the extension is the second
 * opinion rather than the first.
 */
export function classifyFile(name: string, mime: string): FileKind {
  const extension = extensionOf(name);
  if (IMAGE_TYPES.has(mime) || CONVERTED_IMAGE_TYPES.has(mime) || CONVERTED_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (documentFormat(name, mime) !== null) return "document";
  if (REFUSED.some((rule) => rule.test(extension, mime))) return "unsupported";
  if (mime.startsWith("text/") || mime === "image/svg+xml" || mime === "application/json" || mime === "application/xml") return "text";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image";
  return "sniff";
}

export function rejectionReason(name: string, mime: string): string {
  const extension = extensionOf(name);
  const rule = REFUSED.find((candidate) => candidate.test(extension, mime));
  if (rule !== undefined) return rule.reason(name);
  return `${name}: that file isn't text, a picture, or a document this can read. Pictures, text and code, PDF, Word, Excel and PowerPoint files can be attached.`;
}

/** The size limit for this kind: documents may be larger, since only their text is sent. */
export function sizeLimit(name: string, mime: string): number {
  return classifyFile(name, mime) === "document" ? MAX_DOCUMENT_BYTES : MAX_FILE_BYTES;
}

/**
 * Whether bytes are text: no NUL, valid UTF-8, and next to no control characters. A UTF-16
 * file (a byte-order mark, then NULs between letters) counts, and is decoded as such.
 */
export function textFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    try {
      return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be", { fatal: true }).decode(bytes.subarray(2));
    } catch {
      return null;
    }
  }
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return null;
  let control = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) control += 1;
  if (sample.length > 0 && control / sample.length > 0.01) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** Human byte counts for chip labels: "2.4 MB", "18 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which of these files may join the pending strip, and why each refused one may
 * not. Pure over names/sizes/kinds so the composer can report before reading bytes.
 */
export function admitFiles(
  files: readonly { name: string; type: string; size: number }[],
  alreadyPending: number,
): { admitted: number[]; rejected: string[] } {
  const admitted: number[] = [];
  const rejected: string[] = [];
  let count = alreadyPending;
  for (let index = 0; index < files.length; index++) {
    const file = files[index] as { name: string; type: string; size: number };
    const kind = classifyFile(file.name, file.type);
    if (kind === "unsupported") {
      rejected.push(rejectionReason(file.name, file.type));
      continue;
    }
    if (count >= MAX_ATTACHMENTS) {
      rejected.push(`Only ${MAX_ATTACHMENTS} files per message - ${file.name} was left out.`);
      continue;
    }
    const limit = sizeLimit(file.name, file.type);
    if (file.size > limit) {
      rejected.push(`${file.name} is ${formatBytes(file.size)} - the limit is ${formatBytes(limit)}.`);
      continue;
    }
    count += 1;
    admitted.push(index);
  }
  return { admitted, rejected };
}

/** Cut long documents with the cut marked, so the model knows text is missing. */
export function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n…[truncated after ${MAX_TEXT_CHARS} characters]`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  // `btoa` is a window global in the renderer; tests never reach this branch.
  return btoa(binary);
}

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `attachment-${Date.now().toString(36)}-${nextId}`;
}

/**
 * Photos and screenshots arrive at phone-camera sizes; providers downsample past
 * ~1568px on the long side anyway, so shrinking here saves upload without costing
 * anything the model would have seen. GIFs keep their original bytes - resizing
 * would silently kill the animation.
 */
/** The MIME type for a picture the OS named by extension only. */
function imageType(source: AttachmentSource): string {
  if (source.type.length > 0) return source.type;
  const extension = extensionOf(source.name);
  return extension === "jpg" ? "image/jpeg" : extension === "ico" ? "image/x-icon" : `image/${extension}`;
}

async function downscaleImage(source: AttachmentSource): Promise<{ data: string; mediaType: string }> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const type = imageType(source);
  if (type === "image/gif") return { data: bytesToBase64(bytes), mediaType: type };
  // A BMP, icon or AVIF is redrawn as PNG whatever its size: providers refuse those types.
  const convert = !IMAGE_TYPES.has(type);

  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_SIDE && !convert) return { data: bytesToBase64(bytes), mediaType: type };
    const scale = Math.min(1, MAX_IMAGE_SIDE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) {
      if (convert) throw new Error("no canvas");
      return { data: bytesToBase64(bytes), mediaType: type };
    }
    // JPEG has no alpha: white behind transparent screenshots, not black. A converted
    // picture becomes PNG and keeps its transparency.
    if (!convert) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const outType = convert ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, 0.85),
    );
    if (blob === null) {
      if (convert) throw new Error("no picture");
      return { data: bytesToBase64(bytes), mediaType: type };
    }
    const out = new Uint8Array(await blob.arrayBuffer());
    return { data: bytesToBase64(out), mediaType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

/**
 * Read one admitted file into its IPC-ready shape. Throws with a user-facing
 * sentence when the bytes turn out unreadable.
 */
export function fileToAttachment(
  source: AttachmentSource,
  options: { readonly openPdf?: (bytes: Uint8Array) => Promise<PdfLike> } = {},
): Promise<PendingAttachment> {
  const kind = classifyFile(source.name, source.type);
  if (kind === "unsupported") return Promise.reject(new Error(rejectionReason(source.name, source.type)));
  if (source.size > sizeLimit(source.name, source.type)) {
    return Promise.reject(new Error(`${source.name} is too large to attach.`));
  }
  if (kind === "document") {
    const format = documentFormat(source.name, source.type)!;
    return source.arrayBuffer().then(
      async (buffer) => {
        const read = await extractDocument(format, source.name, new Uint8Array(buffer), MAX_TEXT_CHARS, options.openPdf ?? pdfOpener(source.name));
        return {
          id: newId(),
          name: source.name,
          kind: "text" as const,
          mediaType: "text/plain",
          size: source.size,
          previewUrl: "",
          data: truncateText(read.text),
          detail: read.detail,
        };
      },
      () => {
        throw new Error(`${source.name} could not be read.`);
      },
    ).catch((error: unknown) => {
      // Our own refusals already say what to do; anything else is a damaged file.
      if (error instanceof DocumentError) throw new Error(error.message);
      if (error instanceof Error && error.message.startsWith(source.name)) throw error;
      throw new Error(`${source.name} could not be read - the file looks damaged. Open it, save it again, and attach it.`);
    });
  }
  if (kind === "sniff") {
    return source.arrayBuffer().then(
      (buffer) => {
        const text = textFromBytes(new Uint8Array(buffer));
        if (text === null) throw new Error(rejectionReason(source.name, source.type));
        return {
          id: newId(),
          name: source.name,
          kind: "text" as const,
          mediaType: "text/plain",
          size: source.size,
          previewUrl: "",
          data: truncateText(text),
        };
      },
      () => {
        throw new Error(`${source.name} could not be read.`);
      },
    );
  }
  if (kind === "text") {
    return source.text().then(
      (text) => ({
        id: newId(),
        name: source.name,
        kind: "text" as const,
        mediaType: source.type.length > 0 ? source.type : "text/plain",
        size: source.size,
        previewUrl: "",
        data: truncateText(text),
      }),
      () => {
        throw new Error(`${source.name} could not be read as text.`);
      },
    );
  }
  return downscaleImage(source).then(
    ({ data, mediaType }) => ({
      id: newId(),
      name: source.name,
      kind: "image" as const,
      mediaType,
      size: source.size,
      // A data URL of the exact bytes being sent, so the thumbnail shows what
      // the model will see. Revoked with the chip - never written to disk.
      previewUrl: `data:${mediaType};base64,${data}`,
      data,
    }),
    () => {
      throw new Error(`${source.name} could not be read as an image.`);
    },
  );
}
