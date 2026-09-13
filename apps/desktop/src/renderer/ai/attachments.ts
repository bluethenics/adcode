/**
 * Files into assistant turns: picker, drag-drop and paste all land here.
 *
 * Two kinds leave this module. Images (screenshots, mockups, whiteboard photos)
 * travel as base64 for the provider adapters; text documents travel as text so the
 * main process never reads the user's disk for them. Anything else - PDFs, videos,
 * binaries - is refused with a sentence that says what to do instead.
 *
 * DOM lives at the edges (`fileToAttachment` reads Blobs, `downscaleImage` paints
 * a canvas). Everything that decides - classification, limits, truncation - is pure
 * and tested without a window.
 */

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

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonc", "csv", "tsv", "log",
  "yaml", "yml", "xml", "toml", "ini", "cfg", "conf", "sh",
  "js", "jsx", "ts", "tsx", "py", "java", "c", "h", "cpp", "hpp",
  "rs", "go", "rb", "php", "swift", "kt", "sql", "css", "scss",
]);

export type FileKind = "image" | "text" | "unsupported";

/**
 * Image by MIME, text by MIME or extension, everything else refused. The OS often
 * reports no MIME at all (markdown arrives as ""), so the extension is the second
 * opinion rather than the first.
 */
export function classifyFile(name: string, mime: string): FileKind {
  if (IMAGE_TYPES.has(mime)) return "image";
  if (mime.startsWith("text/")) return "text";
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}

export function rejectionReason(name: string, mime: string): string {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return `${name}: PDFs can't be read yet - copy the text into the chat instead.`;
  }
  return `${name}: that file type can't be attached. Images and text documents can.`;
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
    if (file.size > MAX_FILE_BYTES) {
      rejected.push(`${file.name} is ${formatBytes(file.size)} - the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
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
async function downscaleImage(source: AttachmentSource): Promise<{ data: string; mediaType: string }> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (source.type === "image/gif") return { data: bytesToBase64(bytes), mediaType: source.type };

  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: source.type }));
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_IMAGE_SIDE) return { data: bytesToBase64(bytes), mediaType: source.type };
    const scale = MAX_IMAGE_SIDE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (context === null) return { data: bytesToBase64(bytes), mediaType: source.type };
    // JPEG has no alpha: white behind transparent screenshots, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob === null) return { data: bytesToBase64(bytes), mediaType: source.type };
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
export function fileToAttachment(source: AttachmentSource): Promise<PendingAttachment> {
  const kind = classifyFile(source.name, source.type);
  if (kind === "unsupported") return Promise.reject(new Error(rejectionReason(source.name, source.type)));
  if (source.size > MAX_FILE_BYTES) {
    return Promise.reject(new Error(`${source.name} is too large to attach.`));
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
