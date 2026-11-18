/**
 * The "On this page" outline for a rendered doc.
 *
 * The markdown renderer only gives a heading an id when the author wrote `{#anchor}`, and
 * the generated guides never do, so the outline cannot link anywhere on its own. This runs
 * over the finished HTML instead: every `<h2>` and `<h3>` without an id gets one derived
 * from its text, and the same pass returns the list the right-hand rail draws.
 *
 * It works on the renderer's own output, not arbitrary HTML: headings are emitted on one
 * line with no nested headings, which is what makes a regular expression safe here.
 */
export interface DocOutlineItem {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING = /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .trim();
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "section";
}

export function outlineDoc(html: string): { html: string; outline: DocOutlineItem[] } {
  const outline: DocOutlineItem[] = [];
  const taken = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) taken.add(match[1] as string);

  const withIds = html.replace(HEADING, (whole, level: string, attrs: string, inner: string) => {
    const text = plainText(inner);
    if (text.length === 0) return whole;

    const existing = /\sid="([^"]+)"/.exec(attrs);
    let id = existing?.[1];
    if (id === undefined) {
      const base = `doc-${slugify(text)}`;
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      taken.add(id);
    }

    outline.push({ id, text, level: level === "2" ? 2 : 3 });
    return existing === null ? `<h${level}${attrs} id="${id}">${inner}</h${level}>` : whole;
  });

  return { html: withIds, outline };
}
