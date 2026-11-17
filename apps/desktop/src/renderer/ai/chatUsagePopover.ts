/**
 * The usage chip at the top left of the chat, and the box it opens.
 *
 * The chip says the context fill and what this conversation has used so far; the box breaks
 * it down - context, tokens, cost, cache, speed, requests, the models it ran on, today across
 * every chat - and offers the full Usage dialog and the chat importer. It is a floating card,
 * not a page: one click to look, Escape or a click elsewhere to go back to the conversation.
 *
 * Live while open: a reply landing moves the numbers. Closed, it refreshes only the chip, and
 * only when usage or the conversation changes.
 */
import { BarChart3, ChevronRight, Download, Gauge } from "lucide";
import type { UsagePageView } from "../../shared/usagePage.ts";
import type { AiContextUsageView } from "../../shared/api.ts";
import { createIcon } from "../workbench/icons.ts";
import { chatUsageModel, type ChatUsageModel, type ChatUsageRow } from "./chatUsageModel.ts";

export interface ChatUsagePopoverDeps {
  /** The conversation the chat shows now; null for a new, empty one. */
  readonly chatId: () => string | null;
  readonly openUsage: () => void;
  readonly importChats?: () => void;
  readonly compact?: () => void;
}

export interface ChatUsagePopover {
  /** The chip and its card together: what goes in the chat header. */
  readonly element: HTMLElement;
  readonly chip: HTMLButtonElement;
  open(): void;
  refresh(): void;
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function row(item: ChatUsageRow): HTMLElement {
  const line = el("div", "chat-usage-row");
  line.dataset["tone"] = item.tone;
  line.dataset["row"] = item.id;
  const top = el("div", "chat-usage-row-top");
  top.append(el("span", "chat-usage-row-label", item.label), el("strong", "chat-usage-row-value", item.value));
  line.append(top, el("span", "chat-usage-row-detail", item.detail));
  if (item.percent !== null) {
    const bar = el("span", "chat-usage-bar");
    const fill = el("span", "chat-usage-bar-fill");
    fill.style.width = `${String(item.percent)}%`;
    bar.append(fill);
    line.append(bar);
  }
  return line;
}

function action(label: string, icon: Parameters<typeof createIcon>[0], run: () => void): HTMLButtonElement {
  const button = el("button", "chat-usage-action");
  button.type = "button";
  button.append(createIcon(icon), el("span", "", label), createIcon(ChevronRight));
  button.addEventListener("click", run);
  return button;
}

export function createChatUsagePopover(deps: ChatUsagePopoverDeps): ChatUsagePopover {
  const chip = el("button", "chat-usage-chip");
  chip.type = "button";
  chip.setAttribute("aria-haspopup", "dialog");
  chip.setAttribute("aria-expanded", "false");
  chip.dataset["chatAction"] = "chat-usage";
  const chipIcon = createIcon(Gauge);
  const chipText = el("span", "chat-usage-chip-text", "Usage");
  chip.append(chipIcon, chipText);

  // The card lives beside the chip, inside the chat: an expanded chat is a modal dialog in the
  // top layer, and a card left in the page body would sit underneath it, unclickable.
  const element = el("div", "chat-usage");
  const card = el("div", "chat-usage-popover");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "This chat's usage");
  card.hidden = true;
  element.append(chip, card);

  let model: ChatUsageModel = chatUsageModel(null, null, null);
  let generation = 0;
  let pending = false;
  let again = false;

  function paintChip(): void {
    chipText.textContent = model.chip;
    chip.title = model.chipTitle;
    const context = model.rows.find((item) => item.id === "context");
    chip.dataset["tone"] = context?.tone ?? "ok";
  }

  function paintCard(): void {
    const head = el("header", "chat-usage-head");
    head.append(createIcon(Gauge), el("strong", "", "This chat"));
    const children: HTMLElement[] = [head];
    if (model.rows.length === 0 && model.empty) children.push(el("p", "chat-usage-empty", "Nothing used yet. Send a message and its tokens, cost and speed show up here."));
    const list = el("div", "chat-usage-rows");
    for (const item of model.rows) list.append(row(item));
    if (model.rows.length > 0) children.push(list);
    if (model.empty && model.rows.length > 0) children.push(el("p", "chat-usage-empty", "No requests in this chat yet."));

    if (model.models.length > 0) {
      children.push(el("hr", "chat-usage-sep"), el("p", "chat-usage-label", "Models in this chat"));
      const models = el("ul", "chat-usage-models");
      for (const one of model.models) {
        const item = el("li", "chat-usage-model");
        const top = el("div", "chat-usage-row-top");
        top.append(el("span", "chat-usage-model-name", one.name), el("span", "chat-usage-row-detail", `${String(one.share)}%`));
        const bar = el("span", "chat-usage-bar");
        const fill = el("span", "chat-usage-bar-fill");
        fill.style.width = `${String(one.share)}%`;
        bar.append(fill);
        item.append(top, el("span", "chat-usage-row-detail", `${one.provider} · ${one.detail}`), bar);
        models.append(item);
      }
      children.push(models);
    }

    if (model.tips.length > 0) {
      const tips = el("ul", "chat-usage-tips");
      for (const tip of model.tips) tips.append(el("li", "", tip));
      children.push(el("hr", "chat-usage-sep"), tips);
    }

    if (model.today.length > 0) {
      children.push(el("hr", "chat-usage-sep"), el("p", "chat-usage-label", "Today, every chat"));
      const today = el("div", "chat-usage-rows chat-usage-today");
      for (const item of model.today) today.append(row(item));
      children.push(today);
    }

    children.push(el("hr", "chat-usage-sep"));
    const actions = el("div", "chat-usage-actions");
    if (deps.compact !== undefined && model.rows.some((item) => item.id === "context" && item.tone !== "ok")) {
      actions.append(action("Compact now", Gauge, () => { close(); deps.compact?.(); }));
    }
    actions.append(action("Full usage and limits", BarChart3, () => { close(); deps.openUsage(); }));
    if (deps.importChats !== undefined) actions.append(action("Import chats from other apps", Download, () => { close(); deps.importChats?.(); }));
    children.push(actions);
    card.replaceChildren(...children);
  }

  function place(): void {
    // Absolute under the chip; only the height needs working out, to stop at the chat's bottom.
    const rect = chip.getBoundingClientRect();
    const bottom = chip.closest(".chat-card")?.getBoundingClientRect().bottom ?? window.innerHeight;
    card.style.maxHeight = `${String(Math.max(180, bottom - rect.bottom - 18))}px`;
  }

  async function load(): Promise<void> {
    // A change during a read is read again after it, so the box never settles on stale numbers.
    if (pending) { again = true; return; }
    pending = true;
    const mine = ++generation;
    try {
      const id = deps.chatId();
      const [chat, context, today] = await Promise.allSettled([
        id === null ? Promise.resolve(null) : window.adcode.aiUsage.read("all", { chat: id }),
        window.adcode.ai.contextUsage(),
        card.hidden ? Promise.resolve(null) : window.adcode.aiUsage.read("today"),
      ]);
      if (mine !== generation) return;
      const page = (value: PromiseSettledResult<{ readonly page: UsagePageView } | null>): UsagePageView | null => (value.status === "fulfilled" ? value.value?.page ?? null : null);
      model = chatUsageModel(page(chat), context.status === "fulfilled" ? (context.value as AiContextUsageView) : null, page(today));
      paintChip();
      if (!card.hidden) paintCard();
    } finally {
      pending = false;
      if (again) { again = false; void load(); }
    }
  }

  function open(): void {
    card.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    place();
    paintCard();
    void load();
    (card.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function close(): void {
    if (card.hidden) return;
    card.hidden = true;
    chip.setAttribute("aria-expanded", "false");
  }

  chip.addEventListener("click", () => (card.hidden ? open() : close()));
  document.addEventListener("pointerdown", (event) => {
    if (card.hidden || !(event.target instanceof Node)) return;
    if (!card.contains(event.target) && !chip.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || card.hidden) return;
    // Both: stopPropagation keeps the chat's own Escape handler out, preventDefault stops the
    // modal dialog's native cancel, which would otherwise close the whole chat.
    event.stopPropagation();
    event.preventDefault();
    close();
    chip.focus();
  }, true);
  window.addEventListener("resize", () => { if (!card.hidden) place(); });
  window.adcode.aiUsage.onChanged(() => { void load(); });

  // The first read waits for the caller: the chat knows its conversation only once it has loaded.
  paintChip();
  return { element, chip, open, refresh: () => { void load(); }, close };
}
