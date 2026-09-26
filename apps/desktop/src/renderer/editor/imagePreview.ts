/**
 * Image preview for the editor area.
 *
 * Monaco edits text; it has nothing to say about a PNG. When the active tab is an
 * image, this overlay shows instead of the editor host - the same tab strip, the same
 * placeholder rules, just a centred `<img>` with its name, size, and dimensions rather
 * than a buffer. Read-only by construction: there is no model, so there is nothing to
 * save, format, or share over collab.
 */

export interface ImagePreviewData {
  readonly dataUrl: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

export interface ImagePreview {
  readonly element: HTMLElement;
  show(path: string, name: string, data: ImagePreviewData): void;
  hide(): void;
  visible(): boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function createImagePreview(): ImagePreview {
  const element = document.createElement("div");
  element.className = "image-preview";
  element.hidden = true;
  element.setAttribute("role", "img");
  element.dataset["ready"] = "false";

  const figure = document.createElement("figure");
  figure.className = "image-preview-figure";

  const img = document.createElement("img");
  img.className = "image-preview-img";
  img.alt = "";
  img.decoding = "async";

  const caption = document.createElement("figcaption");
  caption.className = "image-preview-caption";

  const nameEl = document.createElement("span");
  nameEl.className = "image-preview-name";
  const metaEl = document.createElement("span");
  metaEl.className = "image-preview-meta";

  caption.append(nameEl, metaEl);
  figure.append(img, caption);
  element.append(figure);

  function onLoad(): void {
    const natural = img.naturalWidth > 0 ? `${img.naturalWidth} × ${img.naturalHeight}px` : null;
    const base = metaEl.dataset["size"] ?? "";
    metaEl.textContent = natural === null ? base : base.length > 0 ? `${base} · ${natural}` : natural;
  }

  img.addEventListener("load", onLoad);
  img.addEventListener("error", () => {
    metaEl.textContent = "Could not display this image.";
  });

  return {
    element,
    show(path, name, data) {
      img.src = data.dataUrl;
      img.alt = name;
      element.setAttribute("aria-label", `Image preview: ${name}`);
      nameEl.textContent = name;
      nameEl.title = path;
      const size = formatBytes(data.sizeBytes);
      metaEl.dataset["size"] = size;
      metaEl.textContent = size;
      element.hidden = false;
      element.dataset["ready"] = "true";
    },
    hide() {
      // Release the object URL / data URL so a folder of large previews does not pile up.
      img.removeAttribute("src");
      img.alt = "";
      element.hidden = true;
      element.dataset["ready"] = "false";
    },
    visible() {
      return !element.hidden;
    },
  };
}

/** Extensions v1 previews, matching the main process allowlist. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
]);

export function isImagePath(path: string): boolean {
  // Synthetic buffers (untitled files, revisions, diffs, local history) are text the
  // editor owns, even when the file they are *of* is an image.
  if (path.startsWith("adcode-")) return false;
  const base = path.split(/[\\/]/).pop() ?? path;
  const withoutRevision = base.split(":")[0] ?? base;
  const parts = withoutRevision.toLowerCase().split(".");
  if (parts.length < 2) return false;
  return IMAGE_EXTENSIONS.has(parts.at(-1) ?? "");
}
