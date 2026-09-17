"use client";

import { useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Writing a post, and seeing it.
 *
 * The admin panel had a bare textarea: you typed markdown, saved, opened the live site,
 * and found out there whether the heading level was right. Which meant publishing was the
 * preview.
 *
 * Three things fix that, and none of them is a dependency. A toolbar that wraps the
 * selection, so nobody has to remember whether it is one asterisk or two. A live preview
 * rendered by the *same* `renderMarkdown` the site uses - not an approximation of it, so
 * what is shown here is what will be published. And a character count, because the blog
 * index truncates descriptions and it is better to find that out while writing.
 *
 * The preview is rendered with `dangerouslySetInnerHTML`, which is safe here for the
 * reason `markdown.ts` documents at length: it escapes every value before adding any
 * markup, and rejects any link scheme that is not http(s) or site-relative. That was
 * written precisely because a human would one day type into a form like this one.
 *
 * Images never paste as bytes. The image button downsizes in the browser, uploads to
 * `POST /v1/admin/post-assets`, and inserts the returned URL - the post row keeps a
 * short address while the bytes live on the asset host, which is what keeps reads fast.
 */
type Wrap = { before: string; after: string };

const ACTIONS: { label: string; title: string; wrap?: Wrap; line?: string }[] = [
  { label: "H2", title: "Heading", line: "## " },
  { label: "H3", title: "Subheading", line: "### " },
  { label: "B", title: "Bold", wrap: { before: "**", after: "**" } },
  { label: "‹›", title: "Inline code", wrap: { before: "`", after: "`" } },
  { label: "Link", title: "Link", wrap: { before: "[", after: "](https://)" } },
  { label: "•", title: "Bulleted list", line: "- " },
  { label: "1.", title: "Numbered list", line: "1. " },
  { label: "❝", title: "Quote", line: "> " },
];

export interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  /** Warn past this many characters. The blog index truncates; this says so early. */
  softLimit?: number;
}

/** Browser-sized before it ever leaves the machine: 1600px on the long edge. */
const MAX_IMAGE_DIM = 1600;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** Roughly the server's 512KB asset ceiling, measured in data-URL characters. */
const MAX_DATA_URL_CHARS = 700_000;

/**
 * A file, as a data URL the asset endpoint accepts.
 *
 * PNG stays PNG so screenshots stay sharp; anything photographic goes to JPEG. An
 * animated GIF arrives as its first frame - documentation has no use for animation,
 * and a still is an honest answer where a silent failure would not be.
 */
async function toWebImage(file: File): Promise<{ dataUrl: string; name: string }> {
  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");

    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const dataUrl =
      file.type === "image/png"
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.82);
    const name = file.name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .slice(0, 80);
    return { dataUrl, name: name.length > 0 ? name : "Image" };
  } finally {
    bitmap.close();
  }
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  rows = 16,
  placeholder,
  softLimit,
}: MarkdownEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { token } = useAuth();
  const [view, setView] = useState<"write" | "preview" | "split">("split");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const html = useMemo(() => renderMarkdown(value), [value]);
  const words = useMemo(() => value.trim().split(/\s+/).filter(Boolean).length, [value]);

  /**
   * Drop a block at the caret, breathing room included.
   *
   * Fences, figures, and embeds only read as blocks with blank lines around them, so
   * the insertion trims the meeting edges and rejoins with exactly two newlines. The
   * optional selection is relative to the inserted text - the video button uses it to
   * leave the placeholder highlighted, ready to be pasted over.
   */
  const insertBlock = (text: string, select?: [number, number]): void => {
    const node = area.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const before = value.slice(0, start).replace(/\s+$/, "");
    const after = value.slice(end).replace(/^\s+/, "");
    const join = (left: string, right: string): string =>
      left.length === 0 || right.length === 0 ? left + right : `${left}\n\n${right}`;

    onChange(join(join(before, text), after));

    const at = before.length === 0 ? 0 : before.length + 2;
    const caret: [number, number] =
      select === undefined ? [at + text.length, at + text.length] : [at + select[0], at + select[1]];
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(caret[0], caret[1]);
    });
  };

  const insertCode = (): void => {
    const node = area.current;
    const selected = node === null ? "" : value.slice(node.selectionStart, node.selectionEnd);
    if (selected.length > 0) {
      const text = `\`\`\`\n${selected}\n\`\`\``;
      insertBlock(text, [4, 4 + selected.length]);
    } else {
      insertBlock("```\n\n```", [4, 4]);
    }
  };

  const insertVideo = (): void => {
    const placeholder = "PASTE_VIDEO_ID_OR_LINK";
    const text = `@[youtube](${placeholder})`;
    insertBlock(text, [10, 10 + placeholder.length]);
  };

  const takeImage = async (file: File | undefined): Promise<void> => {
    setUploadError(null);
    if (file === undefined || uploading) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("That isn't an image. PNG, JPEG, WebP, or GIF.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setUploadError("That file is very large. Try one under 8MB.");
      return;
    }

    setUploading(true);
    try {
      const image = await toWebImage(file);
      if (image.dataUrl.length > MAX_DATA_URL_CHARS) {
        setUploadError("That image is still too large after resizing. Try a smaller one.");
        return;
      }

      const uploaded = await apiFetch<{ url: string }>({
        path: "/admin/post-assets",
        token: await token(),
        method: "POST",
        body: { dataUrl: image.dataUrl },
      });

      if (!uploaded.ok) {
        setUploadError(
          uploaded.error === "unauthenticated"
            ? "Your session expired. Sign in again, then retry the upload."
            : "The upload wasn't accepted. Try a smaller image.",
        );
        return;
      }

      insertBlock(`![${image.name}](${uploaded.value.url})`);
    } catch {
      setUploadError("Couldn't read that image. Try another file.");
    } finally {
      setUploading(false);
    }
  };

  /**
   * Apply a toolbar action to the current selection.
   *
   * The cursor is restored deliberately. A toolbar that wraps the selection and then
   * drops the caret at the end of the document makes writing slower than typing the
   * asterisks by hand, which is the opposite of the point.
   */
  const apply = (action: (typeof ACTIONS)[number]): void => {
    const node = area.current;
    if (node === null) return;

    const start = node.selectionStart;
    const end = node.selectionEnd;
    const selected = value.slice(start, end);

    let next: string;
    let caret: [number, number];

    if (action.line !== undefined) {
      // Line actions apply to whole lines, so they begin at the start of the one the
      // caret is on rather than mid-word.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const head = value.slice(0, lineStart);
      const rest = value.slice(lineStart);
      const [first, ...others] = rest.split("\n");

      next = `${head}${action.line}${first ?? ""}${others.length > 0 ? `\n${others.join("\n")}` : ""}`;
      caret = [start + action.line.length, end + action.line.length];
    } else if (action.wrap !== undefined) {
      const { before, after } = action.wrap;
      next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
      // With nothing selected, land the caret between the markers so typing continues
      // inside them; with a selection, keep the selection.
      caret =
        start === end
          ? [start + before.length, start + before.length]
          : [start + before.length, end + before.length];
    } else {
      return;
    }

    onChange(next);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(caret[0], caret[1]);
    });
  };

  const over = softLimit !== undefined && value.length > softLimit;

  return (
    <div className="md-editor" data-view={view}>
      <div className="md-toolbar">
        <div className="md-actions">
          {ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              className="md-action"
              title={action.title}
              aria-label={action.title}
              onClick={() => apply(action)}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className="md-action"
            title="Code block - add a language after the opening fence, e.g. ```prompt for a full-width prompt box with a copy button"
            aria-label="Code block"
            onClick={insertCode}
          >
            {"{ }"}
          </button>
          <button
            type="button"
            className="md-action"
            title={uploading ? "Uploading image…" : "Upload an image"}
            aria-label="Upload an image"
            aria-disabled={uploading ? "true" : undefined}
            onClick={() => {
              if (!uploading) picker.current?.click();
            }}
          >
            Image
          </button>
          <button
            type="button"
            className="md-action"
            title="Video embed - paste a YouTube or Vimeo id or link over the placeholder"
            aria-label="Video embed"
            onClick={insertVideo}
          >
            Video
          </button>
          <input
            ref={picker}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-hidden="true"
            onChange={(event) => {
              void takeImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <div className="md-views" role="radiogroup" aria-label="Editor view">
          {(["write", "split", "preview"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={view === mode}
              className="md-view"
              onClick={() => setView(mode)}
            >
              {mode === "write" ? "Write" : mode === "split" ? "Split" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      <div className="md-panes">
        <textarea
          ref={area}
          id={id}
          className="textarea md-source"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Tab indents rather than leaving the field. Without this, writing a nested
            // list means reaching for the mouse after every line.
            if (event.key !== "Tab" || event.shiftKey) return;
            event.preventDefault();
            const node = event.currentTarget;
            const at = node.selectionStart;
            onChange(`${value.slice(0, at)}  ${value.slice(node.selectionEnd)}`);
            requestAnimationFrame(() => node.setSelectionRange(at + 2, at + 2));
          }}
        />

        <div className="md-preview post-body" aria-live="polite">
          {value.trim().length === 0 ? (
            <p className="field-hint">Nothing to preview yet.</p>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>

      {uploadError !== null && (
        <p className="md-upload-error" role="alert">
          {uploadError}
          <button
            type="button"
            className="md-action"
            aria-label="Dismiss upload error"
            onClick={() => setUploadError(null)}
          >
            Dismiss
          </button>
        </p>
      )}

      <div className="md-status">
        <span>
          {words.toLocaleString("en-US")} {words === 1 ? "word" : "words"}
        </span>
        <span data-over={over ? "true" : undefined}>
          {value.length.toLocaleString("en-US")}
          {softLimit !== undefined ? ` / ${softLimit.toLocaleString("en-US")}` : ""} characters
        </span>
      </div>
    </div>
  );
}
