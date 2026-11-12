/**
 * Just enough Markdown for a chat reply on a phone, built as DOM nodes - never as HTML text.
 *
 * Fenced code, paragraphs, bullet and numbered lists, headings, inline code, bold, italics and
 * https links. Everything a model writes is text content; the only attribute that comes from
 * it is a link's address, and only an https one is made a link at all.
 */

export type Block =
  | { readonly kind: "code"; readonly lang: string; readonly text: string }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "paragraph"; readonly text: string };

/** Splits a reply into blocks. Pure, so it is tested without a DOM. An unclosed fence stays open: a reply still streaming. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
    if (list !== null) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence !== null) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) { flush(); blocks.push({ kind: "heading", text: heading[1]! }); continue; }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      if (paragraph.length > 0) { blocks.push({ kind: "paragraph", text: paragraph.join("\n") }); paragraph = []; }
      if (list === null || list.ordered !== ordered) { if (list !== null) blocks.push({ kind: "list", ordered: list.ordered, items: list.items }); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (line.trim() === "") { flush(); continue; }
    if (list !== null) { blocks.push({ kind: "list", ordered: list.ordered, items: list.items }); list = null; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) out.push({ kind: "text", text: source.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "strong", text: match[2] });
    else if (match[3] !== undefined) out.push({ kind: "em", text: match[3] });
    else if (match[4] !== undefined) out.push({ kind: "link", text: match[4], href: match[5]! });
    else out.push({ kind: "link", text: match[6]!, href: match[6]! });
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

function inline(target: HTMLElement, text: string): void {
  for (const part of parseInline(text)) {
    if (part.kind === "text") { target.append(document.createTextNode(part.text)); continue; }
    if (part.kind === "link") {
      const anchor = document.createElement("a");
      anchor.href = part.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = part.text;
      target.append(anchor);
      continue;
    }
    const node = document.createElement(part.kind);
    node.textContent = part.text;
    target.append(node);
  }
}

export function renderMarkdown(target: HTMLElement, source: string): void {
  target.replaceChildren();
  for (const block of parseBlocks(source)) {
    if (block.kind === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text;
      if (block.lang !== "") pre.dataset["lang"] = block.lang;
      pre.append(code);
      target.append(pre);
    } else if (block.kind === "heading") {
      const heading = document.createElement("h4");
      inline(heading, block.text);
      target.append(heading);
    } else if (block.kind === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) { const li = document.createElement("li"); inline(li, item); list.append(li); }
      target.append(list);
    } else {
      const p = document.createElement("p");
      inline(p, block.text);
      target.append(p);
    }
  }
}
