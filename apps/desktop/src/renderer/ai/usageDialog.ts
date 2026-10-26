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
import { createUsageActivity } from "./usageActivityView.ts";
import { allowanceSummary } from "./allowanceSummary.ts";
import { BUY_TOKENS_URL, UNLIMITED_REQUESTS_PER_MINUTE, creditWindowSummary, paidTokensSummary, untilText, type CreditsAllowance } from "../../shared/tagflow.ts";
import { openAudienceProfile } from "./audienceProfile.ts";

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
  tokens.title = `${model.inputTokens.toLocaleString()} in${model.cachedTokens > 0 ? ` (${model.cachedTokens.toLocaleString()} cached)` : ""} · ${model.outputTokens.toLocaleString()} out${model.estimated ? " · some counts estimated" : ""}`;
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
    let allowanceRequest = 0;
    let allowanceTimer: ReturnType<typeof setInterval> | undefined;
    const { dialog, card, finish } = openFormModal("ai-usage-dialog", "AI usage", () => {
      request += 1;
      allowanceRequest += 1;
      stop?.();
      clearInterval(allowanceTimer);
      resolve();
    });

    const historyText = "History below covers the selected period and all models on this computer.";
    const freeText = "Included AI is free; costs for your own models are estimates.";
    const historyNote = el("p", "usage-lead", `${historyText} ${freeText}`);
    const allowance = el("div", "usage-allowance", "Checking included AI allowance…");
    const allowanceHelp = el("details", "usage-allowance-help");
    const budgetNote = el("p", "usage-note");
    allowanceHelp.append(
      el("summary", "", "How this allowance works"),
      el("p", "usage-note", "Tokens measure the text the AI reads and writes. One message can use several AI requests as the assistant works with tools. Active replies temporarily hold tokens; unused tokens return when the reply finishes."),
      el("p", "usage-note", "Each AI request reads conversation history, instructions and tool results again. These input tokens count each time, even when the reply is short. For example, sending a 20,000-token context ten times uses about 200,000 input tokens. Start a new chat when changing tasks to avoid carrying older history."),
      el("p", "usage-note", "Completed requests use the provider's token counts when available. Missing counts are marked as estimates. Before a request starts, ADCode temporarily reserves estimated input tokens plus room for the reply. An interrupted request without final counts can use its full reservation."),
      el("p", "usage-note", "If a chat or agent reaches a temporary limit, it waits and resumes automatically when the limit resets. Keep ADCode running. Press Stop to cancel the wait; closing ADCode ends automatic resumption. A request larger than your entire daily allowance needs a smaller conversation or a higher allowance."),
      budgetNote,
    );
    allowanceHelp.hidden = true;
    allowance.setAttribute("role", "status");
    /** Credits replace the token explanation; the summary line stays. */
    function creditHelp(credits: CreditsAllowance): void {
      const lines = [
        `Free AI is metered in credits: one balance for every free model, shared by your chats and agents on all your devices. A credit is about 1,000 tokens on a standard model; partner models that cost less to run use fewer credits, and the model picker says so.`,
        `Your session window opens with your first request and refills ${credits.plan.sessionHours} hours later, with ${credits.plan.sessionCredits.toLocaleString()} credits. The weekly window works the same way over seven days, with ${credits.plan.weeklyCredits.toLocaleString()} credits, so a long run of sessions has a ceiling too.`,
        "A request starts whenever you have credit left, and is charged what it really used when it finishes. Replies in progress hold an estimate until then.",
        "When a window runs out, a running chat or agent waits and carries on by itself when it refills. Keep ADCode open, or press Stop to cancel. Your own connected models never use credits.",
      ];
      allowanceHelp.replaceChildren(el("summary", "", "How credits work"), ...lines.map((line) => el("p", "usage-note", line)));
    }
    function creditRows(credits: CreditsAllowance): HTMLElement[] {
      const now = Date.now();
      const heading = el("div", "usage-allowance-heading");
      heading.append(el("strong", "", "Your free AI credits"), el("span", "usage-allowance-reset", "One balance for every free model"));
      const rows = el("div", "usage-credit-rows");
      for (const [label, window, empty] of [
        ["Current session", credits.session, `Starts with your next request · ${credits.plan.sessionHours}-hour window`],
        ["This week", credits.weekly, "Starts with your next request · 7-day window"],
      ] as const) {
        const summary = creditWindowSummary(window, now);
        const row = el("div", "usage-credit-row");
        row.dataset["tone"] = summary.percent >= 100 ? "full" : summary.percent >= 80 ? "warn" : "ok";
        const text = el("div", "usage-credit-text");
        text.append(el("span", "usage-stat-label", label), el("span", "usage-stat-detail", summary.refill === null ? empty : `Refills in ${summary.refill.in} · ${summary.refill.at}`));
        const progress = el("progress", "ad-progress usage-credit-bar");
        progress.max = 100;
        progress.value = summary.percent;
        progress.setAttribute("aria-label", `${label}: ${summary.percent}% of free AI credits used`);
        const figures = el("div", "usage-credit-figures");
        figures.append(el("strong", "usage-allowance-value", `${summary.percent}% used`), el("span", "usage-stat-detail", `${summary.remaining.toLocaleString()} of ${window.limit.toLocaleString()} credits left`));
        row.append(text, progress, figures);
        rows.append(row);
      }
      const parts: HTMLElement[] = [heading, rows];
      const out = creditWindowSummary(credits.weekly, now).remaining === 0 ? credits.weekly : creditWindowSummary(credits.session, now).remaining === 0 ? credits.session : null;
      if (out !== null && out.resetsAt !== null) {
        parts.push(el("p", "usage-allowance-warning", `${out === credits.weekly ? "This week's" : "This session's"} credits are used up. They refill in ${untilText(out.resetsAt, now)}; a running task carries on by itself then. Your own connected models still work.`));
      }
      return parts;
    }
    card.append(allowance);
    async function refreshAllowance(): Promise<void> {
      const mine = ++allowanceRequest;
      try {
        const view = await window.adcode.aiUsage.allowance();
        if (mine !== allowanceRequest) return;
        allowance.hidden = view === null || !view.available;
        allowanceHelp.hidden = allowance.hidden;
        // "Above" only means something when the allowance is there to point at.
        historyNote.textContent = allowance.hidden ? `${historyText} ${freeText}` : `${historyText} The included-AI allowance above applies across your devices. ${freeText}`;
        if (view === null || !view.available) return;
        if (view.blocked) { allowance.textContent = "Included AI is disabled for this account."; allowanceHelp.hidden = true; return; }
        if (view.unlimited) {
          // With paid tokens on, Heabsy's models have a free week; everything else stays unlimited.
          const paid = view.tokens?.enabled === true ? view.tokens : null;
          allowance.replaceChildren(...(paid === null
            ? [el("strong", "", "Unlimited included AI"), el("p", "usage-note", "No ADCode token, request, or credit allowance. Provider availability and model context limits still apply.")]
            : [el("strong", "", "Included AI"), el("p", "usage-note", paidTokensSummary(paid, Date.now())), button("Buy tokens", "ad-btn ad-btn-tertiary", () => void window.open(BUY_TOKENS_URL, "_blank", "noopener"))]));
          allowanceHelp.hidden = true;
          return;
        }
        if (view.credits !== undefined) {
          allowance.replaceChildren(...creditRows(view.credits));
          creditHelp(view.credits);
          return;
        }
        const summary = allowanceSummary(view);
        const heading = el("div", "usage-allowance-heading");
        heading.append(el("strong", "", "Your free AI today"), el("span", "usage-allowance-reset", `Resets ${summary.reset}`));
        const meters = el("div", "usage-allowance-meters");
        for (const [label, remaining, limit, unit] of [["Tokens left today", summary.remainingTokens, view.limits.dailyTokens, "tokens"], ["AI requests left", summary.remainingRequests, view.limits.dailyRequests, "requests"]] as const) {
          const meter = el("div", "usage-allowance-meter");
          if (remaining === null) {
            meter.append(el("span", "usage-stat-label", "AI requests"), el("strong", "usage-allowance-value", "Unlimited"), el("span", "usage-stat-detail", `${view.usage.requests.toLocaleString()} requests used today`));
          } else {
            const progress = el("progress", "ad-progress");
            progress.max = Math.max(1, limit);
            progress.value = Math.min(limit, remaining);
            progress.setAttribute("aria-label", `${unit === "tokens" ? "Tokens" : "AI requests"} remaining today`);
            meter.append(el("span", "usage-stat-label", label), el("strong", "usage-allowance-value", remaining.toLocaleString()), progress, el("span", "usage-stat-detail", `of ${limit.toLocaleString()} daily ${unit}`));
          }
          meters.append(meter);
        }
        const breakdown = el("p", "usage-note", `${summary.usedTokens.toLocaleString()} tokens used${summary.heldTokens > 0 ? ` · ${summary.heldTokens.toLocaleString()} held for active replies` : ""}. Shared across your devices.`);
        const counts = el("p", "usage-note usage-token-breakdown", `${view.usage.inputTokens.toLocaleString()} input (read) · ${view.usage.outputTokens.toLocaleString()} output (written). ${view.usage.estimatedRequests > 0 ? `${view.usage.estimatedRequests.toLocaleString()} ${view.usage.estimatedRequests === 1 ? "request has" : "requests have"} estimated counts.` : "Completed requests have provider-reported counts."}`);
        const requestLimit = view.limits.requestsPerMinute === UNLIMITED_REQUESTS_PER_MINUTE ? "ADCode has no per-minute request cap. The AI provider may still limit busy periods." : `Up to ${view.limits.requestsPerMinute.toLocaleString()} AI requests per minute.`;
        budgetNote.textContent = `${requestLimit} Service budget: ${formatUsageCost(summary.remainingCost)} left of ${formatUsageCost(view.limits.dailyCostMicros)} today. ADCode pays this cost; you are not charged. Your daily token allowance resets at the time above.`;
        const parts: HTMLElement[] = [heading, meters, breakdown, counts];
        // Partner models with their own allowance draw from it instead of the main one above.
        if ((view.pools ?? []).length > 0) {
          const pools = el("div", "usage-allowance-meters");
          for (const pool of view.pools ?? []) {
            const left = allowanceSummary({ ...view, limits: pool.limits, usage: pool.usage }).remainingTokens;
            const progress = el("progress", "ad-progress");
            progress.max = Math.max(1, pool.limits.dailyTokens);
            progress.value = Math.min(pool.limits.dailyTokens, left);
            progress.setAttribute("aria-label", `${pool.name} tokens remaining today`);
            const meter = el("div", "usage-allowance-meter");
            meter.append(el("span", "usage-stat-label", `${pool.name} models · own allowance`), el("strong", "usage-allowance-value", left.toLocaleString()), progress, el("span", "usage-stat-detail", `of ${pool.limits.dailyTokens.toLocaleString()} daily tokens, separate from the allowance above`));
            pools.append(meter);
          }
          parts.push(pools);
        }
        if (summary.remainingTokens === 0 || summary.remainingRequests === 0 || summary.remainingCost === 0) {
          parts.push(el("p", "usage-allowance-warning", `${summary.remainingTokens === 0 ? "Today's token allowance is used up" : summary.remainingRequests === 0 ? "Today's AI request allowance is used up" : "Today's service budget is used up"}. Wait for the reset above, or use your own connected model.`));
        }
        allowance.replaceChildren(...parts);
      } catch {
        if (mine !== allowanceRequest) return;
        allowance.hidden = false;
        allowanceHelp.hidden = true;
        allowance.replaceChildren(el("span", "usage-note", "Account allowance could not be checked."), button("Retry", "ad-btn ad-btn-tertiary", () => void refreshAllowance()));
      }
    }
    void refreshAllowance();
    allowanceTimer = setInterval(() => void refreshAllowance(), 15_000);

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
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const at = USAGE_RANGES.findIndex((option) => option.value === range);
      const next = USAGE_RANGES[event.key === "Home" ? 0 : event.key === "End" ? USAGE_RANGES.length - 1 : (at + (event.key === "ArrowRight" ? 1 : USAGE_RANGES.length - 1)) % USAGE_RANGES.length]!;
      choose(next.value);
      tabButtons.find((tab) => tab.dataset["range"] === next.value)?.focus();
    });

    const body = el("div", "usage-body");
    body.id = "ai-usage-panel";
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-live", "polite");
    const footer = el("div", "usage-footer");
    const clear = button("Clear usage", "ghost-button usage-clear", () => void clearAll());
    const close = button("Done", "ad-btn ad-btn-primary", () => finish());
    footer.append(clear, button("About your AI use","ad-btn ad-btn-tertiary",() => void openAudienceProfile()), close);
    card.append(tabs, body, footer);

    function paintTabs(): void {
      for (const tab of tabButtons) {
        const on = tab.dataset["range"] === range;
        tab.setAttribute("aria-selected", String(on));
        tab.id = `ai-usage-range-${tab.dataset["range"]}`;
        tab.setAttribute("aria-controls", body.id);
        if (on) body.setAttribute("aria-labelledby", tab.id);
        tab.tabIndex = on ? 0 : -1;
      }
    }

    function paint(view: AiUsageView): void {
      const focusedDay = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["day"] : undefined;
      const focusedHelp = allowanceHelp.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const day = body.querySelector<HTMLElement>('.usage-calendar-cell[tabindex="0"]')?.dataset["day"];
      const scrollLeft = body.querySelector<HTMLElement>(".usage-calendar-scroll")?.scrollLeft;
      const scrollTop = body.scrollTop;
      const activity = createUsageActivity(view.activity, { ...(day === undefined ? {} : { day }), ...(scrollLeft === undefined ? {} : { scrollLeft }) });
      const replace = (...parts: HTMLElement[]): void => {
        body.replaceChildren(allowanceHelp, historyNote, ...parts);
        body.scrollTop = scrollTop;
        if (focusedDay) body.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });
        focusedHelp?.focus({ preventScroll: true });
      };
      clear.disabled = view.since === null;
      if (view.totals.requests === 0) {
        const empty = el("div", "usage-empty");
        empty.append(
          el("strong", "", view.since === null ? "Nothing used yet" : "Nothing in this range"),
          el("p", "", view.since === null
            ? "Send a message in the chat or give an agent a task, and the tokens it uses appear here."
            : "Pick a longer range to see earlier use."),
        );
        replace(activity, empty);
        return;
      }
      const totals = view.totals;
      const stats = el("div", "usage-stats");
      stats.append(
        stat("Tokens", `${totals.estimated ? "≈ " : ""}${formatTokens(totals.inputTokens + totals.outputTokens)}`, `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out${totals.cachedTokens > 0 ? ` · ${formatTokens(totals.cachedTokens)} cached` : ""}`),
        stat("Requests", totals.requests.toLocaleString(), `${view.models.length} ${view.models.length === 1 ? "model" : "models"}`),
        stat("Estimated cost", costText(totals.costMicros, totals.costPartial), totals.costPartial ? "Some models have no price" : "From catalogue prices"),
      );

      const parts: HTMLElement[] = [stats, activity];
      if (view.days.length > 1) {
        const most = Math.max(1, ...view.days.map((day) => day.tokens));
        const chart = el("div", "usage-days");
        chart.style.setProperty("--usage-day-count", String(view.days.length));
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
      if (totals.cachedTokens > 0) {
        const share = Math.round((totals.cachedTokens / Math.max(1, totals.inputTokens)) * 100);
        parts.push(el("p", "usage-note usage-cached-note", `${share}% of the input was cached: the instructions, tools and earlier conversation each step sends again, read back from the provider's prompt cache. It is billed at a fraction of fresh input, and the estimated cost uses that price where the catalogue lists one.`));
      }
      if (totals.estimated) parts.push(el("p", "usage-note", "≈ marks counts ADCode estimated because the provider did not report them."));
      replace(...parts);
    }

    async function refresh(): Promise<void> {
      const mine = ++request;
      try {
        const view = await window.adcode.aiUsage.read(range);
        if (mine === request) paint(view);
      } catch {
        if (mine === request) body.replaceChildren(el("p", "usage-note", "Usage could not be read."), button("Try again", "ad-btn ad-btn-tertiary", () => void refresh()));
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
        body: "This clears this computer’s usage history, activity calendar and streaks. Your account’s included AI allowance and your provider’s billing records are kept.",
        confirmLabel: "Clear",
        danger: true,
      });
      if (!sure) return;
      clear.disabled = true;
      try { await window.adcode.aiUsage.clear(); void refresh(); }
      catch { clear.disabled = false; body.prepend(el("p", "usage-note", "History could not be cleared. Try again.")); }
    }

    stop = window.adcode.aiUsage.onChanged(() => { void refresh(); void refreshAllowance(); });
    dialog.showModal();
    paintTabs();
    body.replaceChildren(el("p", "usage-note", "Loading…"));
    void refresh();
    tabButtons.find((tab) => tab.dataset["range"] === range)?.focus();
  });
}
