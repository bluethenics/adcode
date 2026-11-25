/**
 * The whole conversation as one document: every message, searchable, copyable, savable.
 *
 * The chat window holds about the last 500 messages (`transcriptWindow.ts`): drawing a day's
 * worth as bubbles took 1.2 GB more memory and made each keystroke take half a second. Older
 * history is still all there; this shows it as Markdown in one read-only text box, which
 * costs one text node however long the day was. Find jumps through matches, Copy all and
 * Save as take it elsewhere.
 */
import { exportConversationText } from "./chatExport.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";

export interface FullConversationInput {
  readonly title: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
}

/** Where the next match of `query` starts at or after `from`, wrapping round; -1 with none. */
export function nextMatch(haystack: string, query: string, from: number): number {
  if (query.length === 0) return -1;
  const at = haystack.indexOf(query, from);
  if (at !== -1) return at;
  return from > 0 ? haystack.indexOf(query) : -1;
}

/** How many times `query` appears, stopping at `cap` so a one-letter search stays instant. */
export function countMatches(haystack: string, query: string, cap = 9_999): number {
  if (query.length === 0) return 0;
  let count = 0;
  for (let at = haystack.indexOf(query); at !== -1 && count < cap; at = haystack.indexOf(query, at + query.length)) count += 1;
  return count;
}

export function openFullConversation(input: FullConversationInput): void {
  const { text, fileName } = exportConversationText(input.title, input.messages.map((message) => [message.role, message.text] as const), "markdown", new Date());
  const lower = text.toLowerCase();
  const { dialog, card, finish } = openFormModal("full-conversation-dialog", input.title, () => undefined);

  const bar = el("div", "full-conversation-bar");
  const search = el("input", "ad-input full-conversation-search");
  search.type = "search";
  search.placeholder = "Find in this conversation";
  search.setAttribute("aria-label", "Find in this conversation");
  const found = el("span", "full-conversation-found");
  found.setAttribute("aria-live", "polite");
  const box = el("textarea", "ad-input full-conversation-text");
  box.readOnly = true;
  box.spellcheck = false;
  box.value = text;
  box.setAttribute("aria-label", `The whole conversation: ${String(input.messages.length)} messages`);

  let cursor = 0;
  function find(advance: boolean): void {
    const query = search.value.trim().toLowerCase();
    if (query.length === 0) {
      found.textContent = "";
      return;
    }
    const at = nextMatch(lower, query, advance ? cursor + 1 : cursor);
    const total = countMatches(lower, query);
    if (at === -1) {
      found.textContent = "No matches";
      return;
    }
    cursor = at;
    // Selecting in a focused box scrolls it to the match; focus goes back to the search after.
    box.focus();
    box.setSelectionRange(at, at + query.length);
    search.focus();
    found.textContent = total >= 9_999 ? "9,999+ matches" : `${total.toLocaleString()} match${total === 1 ? "" : "es"}`;
  }
  search.addEventListener("input", () => { cursor = 0; find(false); });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      find(true);
    }
  });

  const copy = button("Copy all", "ad-btn ad-btn-tertiary", () => {
    void navigator.clipboard.writeText(text).then(
      () => { copy.textContent = "Copied"; },
      () => { copy.textContent = "Could not copy"; },
    ).finally(() => window.setTimeout(() => { copy.textContent = "Copy all"; }, 1_400));
  });
  const save = button("Save as…", "ad-btn ad-btn-tertiary", () => { void window.adcode.files.saveAs(text, fileName).catch(() => null); });
  const close = button("Done", "ad-btn ad-btn-primary", () => finish());
  bar.append(search, found);
  const footer = el("div", "full-conversation-footer");
  footer.append(el("span", "full-conversation-size", `${input.messages.length.toLocaleString()} messages`), copy, save, close);
  card.append(bar, box, footer);
  dialog.showModal();
  search.focus();
}
