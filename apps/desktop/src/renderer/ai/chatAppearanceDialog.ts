/**
 * Customise chat: how the assistant and agents look in the conversation.
 *
 * Every choice here is also a row in Settings > Appearance; this dialog exists because
 * picking a face and a reply style from five separate dropdowns, with nothing to look at,
 * is choosing blind. The preview is a small conversation drawn with the real chat's
 * classes, so what it shows is what the chat will do.
 */
import { createAgentMascot } from "../agents/agentMascot.ts";
import { MASCOT_COLORS, MASCOT_SHAPES } from "../agents/mascotStyle.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import {
  AGENT_AVATARS_SETTING,
  ASSISTANT_COLOR_SETTING,
  ASSISTANT_NAME_SETTING,
  ASSISTANT_SHAPE_SETTING,
  assistantName,
  chatAppearanceFrom,
  DEFAULT_ASSISTANT_LOOK,
  DEFAULT_ASSISTANT_NAME,
  MESSAGE_STYLE_SETTING,
  type ChatAppearance,
  type MessageStyle,
} from "./chatAppearance.ts";

const STYLES: readonly { readonly value: MessageStyle; readonly label: string; readonly hint: string }[] = [
  { value: "document", label: "Document", hint: "Replies run full width, like a page" },
  { value: "bubbles", label: "Bubbles", hint: "Each reply in a soft card" },
  { value: "compact", label: "Compact", hint: "Tighter, to fit more on screen" },
];

/** The settings writes a choice needs: only the rows that changed. */
export function appearanceWrites(before: ChatAppearance, after: ChatAppearance): readonly (readonly [string, string | boolean])[] {
  const writes: (readonly [string, string | boolean])[] = [];
  if (before.name !== after.name) writes.push([ASSISTANT_NAME_SETTING, after.name]);
  if (before.look.shape !== after.look.shape) writes.push([ASSISTANT_SHAPE_SETTING, after.look.shape]);
  if (before.look.color !== after.look.color) writes.push([ASSISTANT_COLOR_SETTING, after.look.color]);
  if (before.avatars !== after.avatars) writes.push([AGENT_AVATARS_SETTING, after.avatars]);
  if (before.style !== after.style) writes.push([MESSAGE_STYLE_SETTING, after.style]);
  return writes;
}

/** Open the dialog. Resolves true when something was saved. */
export async function openChatAppearanceDialog(options: { readonly openAgents?: () => void } = {}): Promise<boolean> {
  const values = await window.adcode.settings.read().catch(() => ({}));
  const before = chatAppearanceFrom(values);
  let draft: ChatAppearance = before;

  return new Promise((resolve) => {
    let saved = false;
    const { dialog, card, finish } = openFormModal("chat-appearance-dialog", "Customise chat", () => resolve(saved));
    card.append(el("p", "result-summary chat-appearance-lead", "How the assistant looks in the conversation, and how every agent's replies sit on the page. Saved agents keep the look you gave them on the Agents board."));

    /* ── Preview ─────────────────────────────────────────────────────── */
    const preview = el("div", "chat-card chat-appearance-preview");
    preview.setAttribute("aria-hidden", "true");
    const previewTranscript = el("div", "chat-transcript");
    const ask = el("div", "chat-bubble chat-bubble-user", "Can you make the header stay at the top while I scroll?");
    const author = el("div", "chat-author");
    const previewMascot = createAgentMascot({ look: draft.look, mood: "happy", size: 18 });
    const authorName = el("span", "chat-author-name", draft.name);
    author.append(previewMascot.element, authorName);
    const answer = el("div", "chat-bubble chat-bubble-assistant");
    answer.append(el("p", "chat-md-para", "Done. The header is now sticky, with a soft shadow once the page scrolls under it."));
    // As in the chat: the face signs the reply; the row at work has none of its own.
    const workingRow = el("div", "chat-working");
    const dots = el("span", "chat-working-dots");
    dots.append(el("i", ""), el("i", ""), el("i", ""));
    workingRow.append(dots, el("span", "chat-working-text", "Checking the page"));
    previewTranscript.append(ask, author, answer, workingRow);
    preview.append(previewTranscript);

    /* ── Controls ────────────────────────────────────────────────────── */
    const name = el("input", "form-input");
    name.maxLength = 40;
    name.placeholder = DEFAULT_ASSISTANT_NAME;
    name.value = draft.name === DEFAULT_ASSISTANT_NAME ? "" : draft.name;
    name.addEventListener("input", () => {
      draft = { ...draft, name: assistantName(name.value) };
      paint();
    });

    const shapes = el("div", "agents-swatches agents-shapes");
    shapes.setAttribute("role", "radiogroup");
    shapes.setAttribute("aria-label", "Shape");
    for (const shape of MASCOT_SHAPES) {
      const choice = button("", "agents-swatch", () => { draft = { ...draft, look: { ...draft.look, shape } }; paint(); });
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-label", shape);
      choice.title = shape;
      choice.dataset["value"] = shape;
      choice.append(createAgentMascot({ look: { shape, color: "slate" }, mood: "sleepy", size: 22 }).element);
      shapes.append(choice);
    }
    const colors = el("div", "agents-swatches agents-colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", "Colour");
    for (const color of MASCOT_COLORS) {
      const choice = button("", "agents-swatch agents-color-swatch", () => { draft = { ...draft, look: { ...draft.look, color } }; paint(); });
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-label", color);
      choice.title = color;
      choice.dataset["value"] = color;
      choice.style.setProperty("--swatch", `var(--mascot-${color})`);
      colors.append(choice);
    }
    const look = el("div", "agents-look-pickers");
    look.append(shapes, colors);

    const styles = el("div", "ad-tabs chat-appearance-styles");
    styles.setAttribute("role", "radiogroup");
    styles.setAttribute("aria-label", "Reply style");
    for (const option of STYLES) {
      const choice = button(option.label, "ad-tab", () => { draft = { ...draft, style: option.value }; paint(); });
      choice.setAttribute("role", "radio");
      choice.title = option.hint;
      choice.dataset["value"] = option.value;
      styles.append(choice);
    }

    const avatarsLabel = el("label", "chat-appearance-toggle");
    const avatars = el("input", "");
    avatars.type = "checkbox";
    avatars.checked = draft.avatars;
    avatars.addEventListener("change", () => {
      draft = { ...draft, avatars: avatars.checked };
      paint();
    });
    avatarsLabel.append(avatars, el("span", "", "Show who is replying - a face and a name above replies and on the line that says it is writing"));

    const notice = el("p", "form-notice");
    notice.hidden = true;
    const actions = el("div", "chat-appearance-actions");
    const reset = button("Reset to default", "ghost-button", () => {
      draft = { name: DEFAULT_ASSISTANT_NAME, look: DEFAULT_ASSISTANT_LOOK, avatars: true, style: "document" };
      name.value = "";
      avatars.checked = true;
      paint();
    });
    const spacer = el("span", "chat-appearance-spacer");
    const cancel = button("Cancel", "confirm-cancel", () => finish());
    const save = button("Save", "ad-btn ad-btn-primary", () => void commit());
    actions.append(reset, spacer, cancel, save);
    if (options.openAgents !== undefined) {
      const agents = button("Edit saved agents…", "ghost-button", () => {
        finish();
        options.openAgents?.();
      });
      actions.insertBefore(agents, spacer);
    }

    card.append(
      preview,
      field("Name", name, "Shown above its replies and while it is writing."),
      field("Face", look),
      field("Reply style", styles),
      avatarsLabel,
      notice,
      actions,
    );

    function paint(): void {
      preview.dataset["messageStyle"] = draft.style;
      preview.dataset["avatars"] = String(draft.avatars);
      previewMascot.setLook(draft.look);
      authorName.textContent = draft.name;
      for (const item of shapes.querySelectorAll<HTMLButtonElement>("button")) item.setAttribute("aria-checked", String(item.dataset["value"] === draft.look.shape));
      for (const item of colors.querySelectorAll<HTMLButtonElement>("button")) item.setAttribute("aria-checked", String(item.dataset["value"] === draft.look.color));
      for (const item of styles.querySelectorAll<HTMLButtonElement>("button")) {
        const on = item.dataset["value"] === draft.style;
        item.setAttribute("aria-checked", String(on));
        item.setAttribute("aria-selected", String(on));
      }
    }

    async function commit(): Promise<void> {
      save.disabled = true;
      notice.hidden = true;
      try {
        for (const [id, value] of appearanceWrites(before, draft)) await window.adcode.settings.write(id, value);
        saved = true;
        finish();
      } catch {
        notice.textContent = "Could not save. Try again.";
        notice.hidden = false;
        save.disabled = false;
      }
    }

    paint();
    dialog.showModal();
    name.focus();
  });
}
