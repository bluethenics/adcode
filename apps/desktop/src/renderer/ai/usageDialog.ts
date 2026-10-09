/**
 * AI usage: tokens and an estimated cost per model, for a range you pick.
 *
 * A dialog rather than a page because the question it answers is quick - "how much have I
 * used, and on what?" - and the answer should be one shortcut away from wherever you are.
 * It stays live while open: an agent working in the background moves the numbers.
 *
 * The numbers come from `shared/aiUsage.ts`, which says what it does not know. This view
 * repeats that out loud: an estimate is marked as one, and a model with no catalogue price
 * says so instead of showing $0.00.
 */
import {
  formatTokens,
  formatUsageCost,
  USAGE_RANGES,
  type AiUsageView,
  type UsageModelView,
  type UsageRange,
} from "../../shared/aiUsage.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";

const RANGE_KEY = "adcode.usage.range";

function savedRange(): UsageRange {
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (saved === "today" || saved === "7d" || saved === "30d" || saved === "all") return saved;
  } catch {
    // Storage blocked: the default range is fine.
  }
  return "7d";
}

function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1).toLocaleDateString([], { month: "short", day: "numeric" });
}

function costText(micros: number | null, partial: boolean): string {
  return `${formatUsageCost(micros)}${partial && micros !== null ? "+" : ""}`;
}

function stat(label: string, value: string, detail: string): HTMLElement {
  const tile = el("div", "usage-stat");
  tile.append(el("span", "usage-stat-label", label), el("strong", "usage-stat-value", value), el("span", "usage-stat-detail", detail));
  return tile;
}

function modelRow(model: UsageModelView): HTMLElement {
  const row = el("li", "usage-model");
  const name = el("div", "usage-model-name");
  const title = el("strong", "", model.model);
  title.title = model.model;
  name.append(title, el("span", "usage-model-provider", model.provider));
  const bar = el("span", "usage-model-bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = el("span", "");
  fill.style.setProperty("--share", `${Math.max(2, Math.round(model.share * 100))}%`);
  bar.append(fill);
  const tokens = el("span", "usage-model-tokens", `${model.estimated ? "≈ " : ""}${formatTokens(model.inputTokens + model.outputTokens)}`);
  tokens.title = `${model.inputTokens.toLocaleString()} in · ${model.outputTokens.toLocaleString()} out${model.estimated ? " · some counts estimated" : ""}`;
  const requests = el("span", "usage-model-requests", `${model.requests.toLocaleString()} ${model.requests === 1 ? "request" : "requests"}`);
  requests.title = `${model.chatRequests.toLocaleString()} from the chat · ${model.agentRequests.toLocaleString()} from agents`;
  const cost = el("span", "usage-model-cost", costText(model.costMicros, model.costPartial));
  cost.title = model.costMicros === null
    ? "The model catalogue has no price for this model."
    : model.costPartial ? "Some requests had no price, so this is less than the whole." : "Estimated from the catalogue's price per million tokens.";
  row.append(name, bar, tokens, requests, cost);
  return row;
}

/** Open the usage dialog. Resolves when it closes. */
export function openUsageDialog(): Promise<void> {
  return new Promise((resolve) => {
    let range = savedRange();
    let stop: (() => void) | null = null;
    let request = 0;
    const { dialog, card, finish } = openFormModal("ai-usage-dialog", "AI usage", () => {
      stop?.();
      resolve();
    });

    card.append(el("p", "usage-lead", "Tokens and estimated cost for the chat and every agent, kept on this machine. Your provider's billing page has the exact bill."));

    const tabs = el("div", "ad-tabs usage-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Range");
    const tabButtons = USAGE_RANGES.map((option) => {
      const tab = button(option.label, "ad-tab", () => choose(option.value));
      tab.setAttribute("role", "tab");
      tab.dataset["range"] = option.value;
      return tab;
    });
    tabs.append(...tabButtons);
    tabs.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const at = USAGE_RANGES.findIndex((option) => option.value === range);
      const next = USAGE_RANGES[(at + (event.key === "ArrowRight" ? 1 : USAGE_RANGES.length - 1)) % USAGE_RANGES.length]!;
      choose(next.value);
      tabButtons.find((tab) => tab.dataset["range"] === next.value)?.focus();
    });

    const body = el("div", "usage-body");
    body.setAttribute("aria-live", "polite");
    const footer = el("div", "usage-footer");
    const clear = button("Clear usage", "ghost-button usage-clear", () => void clearAll());
    const close = button("Done", "ad-btn ad-btn-primary", () => finish());
    footer.append(clear, close);
    card.append(tabs, body, footer);

    function paintTabs(): void {
      for (const tab of tabButtons) {
        const on = tab.dataset["range"] === range;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
      }
    }

    function paint(view: AiUsageView): void {
      clear.disabled = view.since === null;
      if (view.totals.requests === 0) {
        const empty = el("div", "usage-empty");
        empty.append(
          el("strong", "", view.since === null ? "Nothing used yet" : "Nothing in this range"),
          el("p", "", view.since === null
            ? "Send a message in the chat or give an agent a task, and the tokens it uses appear here."
            : "Pick a longer range to see earlier use."),
        );
        body.replaceChildren(empty);
        return;
      }
      const totals = view.totals;
      const stats = el("div", "usage-stats");
      stats.append(
        stat("Tokens", `${totals.estimated ? "≈ " : ""}${formatTokens(totals.inputTokens + totals.outputTokens)}`, `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`),
        stat("Requests", totals.requests.toLocaleString(), `${view.models.length} ${view.models.length === 1 ? "model" : "models"}`),
        stat("Estimated cost", costText(totals.costMicros, totals.costPartial), totals.costPartial ? "Some models have no price" : "From catalogue prices"),
      );

      const parts: HTMLElement[] = [stats];
      if (view.days.length > 1) {
        const most = Math.max(1, ...view.days.map((day) => day.tokens));
        const chart = el("div", "usage-days");
        chart.setAttribute("role", "img");
        chart.setAttribute("aria-label", `Tokens per day, ${shortDay(view.days[0]!.day)} to ${shortDay(view.days[view.days.length - 1]!.day)}`);
        for (const day of view.days) {
          const column = el("span", "usage-day");
          column.style.setProperty("--height", `${day.tokens === 0 ? 0 : Math.max(4, Math.round((day.tokens / most) * 100))}%`);
          column.title = `${shortDay(day.day)}: ${formatTokens(day.tokens)} tokens`;
          chart.append(column);
        }
        parts.push(chart);
      }

      const list = el("ul", "usage-models");
      list.setAttribute("aria-label", "Usage by model");
      for (const model of view.models) list.append(modelRow(model));
      parts.push(list);
      if (totals.estimated) parts.push(el("p", "usage-note", "≈ marks counts ADCode estimated because the provider did not report them."));
      body.replaceChildren(...parts);
    }

    async function refresh(): Promise<void> {
      const mine = ++request;
      try {
        const view = await window.adcode.aiUsage.read(range);
        if (mine === request) paint(view);
      } catch {
        if (mine === request) body.replaceChildren(el("p", "usage-note", "Usage could not be read."));
      }
    }

    function choose(next: UsageRange): void {
      range = next;
      try {
        localStorage.setItem(RANGE_KEY, next);
      } catch {
        // Remembering the range is a convenience.
      }
      paintTabs();
      void refresh();
    }

    async function clearAll(): Promise<void> {
      const sure = await askThemed({
        title: "Clear AI usage?",
        body: "Every count on this page is removed from this machine. Your provider's own records are not affected.",
        confirmLabel: "Clear",
        danger: true,
      });
      if (!sure) return;
      await window.adcode.aiUsage.clear();
      void refresh();
    }

    stop = window.adcode.aiUsage.onChanged(() => void refresh());
    dialog.showModal();
    paintTabs();
    body.replaceChildren(el("p", "usage-note", "Loading…"));
    void refresh();
    tabButtons.find((tab) => tab.dataset["range"] === range)?.focus();
  });
}
