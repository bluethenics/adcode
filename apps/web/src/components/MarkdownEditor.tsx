"use client";

import { useMemo, useRef, useState } from "react";
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

export function MarkdownEditor({
  id,
  value,
  onChange,
  rows = 16,
  placeholder,
  softLimit,
}: MarkdownEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"write" | "preview" | "split">("split");

  const html = useMemo(() => renderMarkdown(value), [value]);
  const words = useMemo(() => value.trim().split(/\s+/).filter(Boolean).length, [value]);

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
