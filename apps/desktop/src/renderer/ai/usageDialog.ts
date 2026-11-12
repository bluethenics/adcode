/**
 * Usage: what the AI used and cost, laid out like T3 Code's Usage page and then some.
 *
 * "Usage / All projects / All providers" across the top, a range and a Cost / Tokens /
 * Limits switch under it, and one scrolling page below: a plain-words summary, the big
 * total, a row per provider, a smoothed chart, totals, a split by type, a breakdown table,
 * and the questions T3 leaves open - cost per request and per chat, busiest hours, the
 * costliest chats, the quickest model, and what the same work would cost elsewhere.
 * Limits is the included-AI allowance and paid credits, as before.
 *
 * A dialog rather than a page because the question is quick and should be one shortcut away.
 * It stays live while open: an agent working in the background moves the numbers.
 *
 * The numbers come from `shared/usagePage.ts`, which says what it does not know; this view
 * repeats that out loud instead of drawing a zero.
 */
import { USAGE_RANGES, formatUsageCost, type UsageRange } from "../../shared/aiUsage.ts";
import type { AnalysedUsageView } from "../../shared/usageInsights.ts";
import { usagePage, type UsageFilter, type UsagePageView } from "../../shared/usagePage.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";
import { createUsageActivity } from "./usageActivityView.ts";
import { segmentIndicator } from "./usageMotion.ts";
import { USAGE_SECTIONS, usagePageTabs, type PricedModel, type UsageMetric, type UsagePageState, type UsageSection } from "./usagePageView.ts";
import { allowanceSummary } from "./allowanceSummary.ts";
import { BUY_TOKENS_URL, UNLIMITED_REQUESTS_PER_MINUTE, aiPlanName, isFairUsePlan, creditWindowSummary, percentLeft, untilText, type CreditsAllowance, type TagflowAllowanceView } from "../../shared/tagflow.ts";
import { openAudienceProfile } from "./audienceProfile.ts";
import { formatTokens } from "../../shared/aiUsage.ts";

export type UsageView = UsageMetric | "limits";

export interface UsageDialogOptions {
  /** Which view to open on; the last one used otherwise. */
  readonly view?: UsageView;
  /** Opens the chat's conversation list, for the costliest-chats section. */
  readonly showConversations?: () => void;
  /** Opens one conversation by id, for a row in the costliest-chats section. */
  readonly openChat?: (id: string) => void;
}

const RANGE_KEY = "adcode.usage.range";
const VIEW_KEY = "adcode.usage.view";
const SECTION_KEY = "adcode.usage.section";

function saved<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value !== null && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    // Storage blocked: the default is fine.
  }
  return fallback;
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
}

const KNOWN_PROVIDERS: Readonly<Record<string, string>> = {
  tagflow: "Included AI", anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter", ollama: "Ollama",
  deepseek: "DeepSeek", mistral: "Mistral", xai: "xAI", groq: "Groq", custom: "Custom endpoint",
  "cli-claude": "Claude Code", "cli-codex": "Codex", "cli-opencode": "OpenCode", "cli-gemini": "Gemini CLI",
};

/** The last folder of a path: "shop" for "E:\work\shop". */
export function projectName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

function stat(label: string, value: string, detail: string): HTMLElement {
  const tile = el("div", "usage-stat");
  tile.append(el("span", "usage-stat-label", label), el("strong", "usage-stat-value", value), el("span", "usage-stat-detail", detail));
  return tile;
}

/** Open the usage dialog. Resolves when it closes. */
export function openUsageDialog(options: UsageDialogOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    let range = saved<UsageRange>(RANGE_KEY, ["today", "7d", "30d", "90d"], "7d");
    let view: UsageView = options.view ?? saved<UsageView>(VIEW_KEY, ["cost", "tokens", "limits"], "cost");
    const filter: { project: string | null; provider: string | null } = { project: null, provider: null };
    const state: UsagePageState = { breakdown: "model", whatIf: null, section: saved<UsageSection>(SECTION_KEY, USAGE_SECTIONS.map((option) => option.value), "overview"), expanded: new Set() };
    /** What the page last drew, so switching Cost and Tokens needs no new read. */
    let last: AnalysedUsageView | null = null;
    /** The range and view whose sections have already drawn themselves in. */
    let entered = "";
    let stop: (() => void) | null = null;
    let request = 0;
    let allowanceRequest = 0;
    let allowanceTimer: ReturnType<typeof setInterval> | undefined;
    const names = new Map<string, string>();
    const chatTitles = new Map<string, string>();
    let prices: PricedModel[] = [];
    const { dialog, card, title, finish } = openFormModal("ai-usage-dialog", "Usage", () => {
      request += 1;
      // Closed: any read still out is dropped, and no further read starts.
      allowanceRequest = -1;
      stop?.();
      clearInterval(allowanceTimer);
      resolve();
    });
    const nameOf = (provider: string): string => names.get(provider) ?? KNOWN_PROVIDERS[provider] ?? (provider.startsWith("cli-") ? `${provider.slice(4)} CLI` : provider.charAt(0).toUpperCase() + provider.slice(1));

    // Usage / All projects / All providers
    const head = el("header", "usage-head");
    const crumbs = el("nav", "usage-crumbs");
    crumbs.setAttribute("aria-label", "Filter usage");
    const projectSelect = el("select", "ad-input ad-select usage-crumb-select");
    projectSelect.setAttribute("aria-label", "Project");
    const providerSelect = el("select", "ad-input ad-select usage-crumb-select");
    providerSelect.setAttribute("aria-label", "Provider");
    const slash = (): HTMLElement => {
      const node = el("span", "usage-crumb-slash", "/");
      node.setAttribute("aria-hidden", "true");
      return node;
    };
    title.classList.add("usage-crumb-title");
    crumbs.append(title, slash(), projectSelect, slash(), providerSelect);
    head.append(crumbs);
    projectSelect.addEventListener("change", () => { filter.project = projectSelect.value === "" ? null : projectSelect.value; entered = ""; void refresh(); });
    providerSelect.addEventListener("change", () => { filter.provider = providerSelect.value === "" ? null : providerSelect.value; entered = ""; void refresh(); });

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
    const limitsEmpty = el("div", "usage-panel-empty");
    limitsEmpty.append(el("strong", "", "No limits to show"), el("p", "", "Limits apply only to the AI included with ADCode. Your own keys and coding CLIs are limited by their provider, not by ADCode."));
    limitsEmpty.hidden = true;
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
    const paidWallet = el("section", "usage-allowance");
    paidWallet.hidden = true;
    /*
     * One read at a time, and every answer is drawn. This used to start a new read on every
     * usage change and throw away any answer that a newer read had overtaken - and while a
     * chat or agent is working, usage changes every second, so a read slower than that was
     * always overtaken and Limits sat on "Checking..." for good (reported 12 November 2026).
     * A change during a read now asks for one more read after it.
     */
    let allowanceBusy = false;
    let allowanceAgain = false;
    function refreshAllowance(): Promise<void> {
      if (allowanceBusy) { allowanceAgain = true; return Promise.resolve(); }
      allowanceBusy = true;
      return readAllowance().finally(() => {
        allowanceBusy = false;
        if (allowanceAgain && allowanceRequest >= 0) { allowanceAgain = false; void refreshAllowance(); }
      });
    }
    /** True when this machine has no signed-in account; null when that could not be told in 3 seconds. */
    const signedOutCheck = (): Promise<boolean | null> => Promise.race([
      Promise.resolve().then(() => window.adcode.account.status()).then((account) => account.state === "anonymous" || account.state === "unavailable").catch(() => null),
      // The account check is a round trip too; past the allowance's own deadline it is no help.
      new Promise<null>((done) => setTimeout(() => done(null), 10_000)),
    ]);
    /** Set once anything real is drawn, so a late "sign in" never covers an allowance. */
    let allowanceShown = false;
    function showSignIn(): void {
      allowance.hidden = true;
      allowance.replaceChildren();
      allowanceHelp.hidden = true;
      explainMissing(true);
    }
    /** Signed out, or signed in and the read failed: the two need different words. */
    function explainMissing(signedOut: boolean): void {
      limitsEmpty.replaceChildren(
        el("strong", "", signedOut ? "Sign in to see your allowance" : "Your allowance could not be read just now"),
        el("p", "", signedOut
          ? "Limits belong to your ADCode account. Sign in from the account menu and your included AI allowance shows here. Your own keys and coding CLIs are limited only by their provider."
          : "ADCode could not reach your account. Check your connection and try again. Your own keys and coding CLIs keep working either way."),
        ...(signedOut ? [] : [button("Try again", "ad-btn ad-btn-secondary", () => void refreshAllowance())]),
      );
      limitsEmpty.hidden = false;
    }
    async function readAllowance(): Promise<void> {
      const mine = allowanceRequest;
      // Signed out is known in a moment, while the allowance read itself can take the main
      // process's full 12 seconds to give up; say "sign in" as soon as that is clear.
      const signedOut = signedOutCheck();
      void signedOut.then((out) => { if (out === true && !allowanceShown && mine === allowanceRequest) showSignIn(); });
      // A slow answer is said to be slow, rather than "Checking..." sitting there unexplained.
      const slow = setTimeout(() => {
        if (!allowanceShown && limitsEmpty.hidden && mine === allowanceRequest) allowance.replaceChildren(el("span", "usage-note", "Still checking your allowance. A slow connection can take a few seconds; your own models keep working meanwhile."));
      }, 4_000);
      try {
        // A signed-in read that has not answered in 10 seconds is reported, not waited on.
        const view = await Promise.race([
          window.adcode.aiUsage.allowance(),
          new Promise<never>((_done, fail) => setTimeout(() => fail(new Error("allowance timed out")), 10_000)),
        ]);
        if (mine !== allowanceRequest) return;
        if (view === null) {
          allowance.hidden = true;
          allowanceHelp.hidden = true;
          paidWallet.hidden = true;
          explainMissing((await signedOut) === true);
          return;
        }
        allowanceShown = true;
        paidWallet.hidden = view?.wallet === undefined;
        if (view?.wallet) paidWallet.replaceChildren(
          el("strong", "", "Paid model credits"),
          stat("Available", `$${(view.wallet.availableMicros/1_000_000).toFixed(4)}`, "USD, for paid models"),
          el("p", "usage-note", `$${(view.wallet.reservedMicros/1_000_000).toFixed(4)} held for active requests. Separate from included tokens and Heabsy subscriptions.`),
          button("Add paid credits", "ad-btn ad-btn-secondary", ()=>void window.open(`${BUY_TOKENS_URL}#wallet`,"_blank","noopener")),
        );
        allowance.hidden = view === null || !view.available;
        allowanceHelp.hidden = allowance.hidden;
        limitsEmpty.replaceChildren(el("strong", "", "No limits to show"), el("p", "", "Limits apply only to the AI included with ADCode, which this account does not use. Your own keys and coding CLIs are limited by their provider, not by ADCode."));
        limitsEmpty.hidden = !allowance.hidden || !paidWallet.hidden;
        if (!view.available) return;
        if (view.blocked) { allowance.textContent = "Included AI is disabled for this account."; allowanceHelp.hidden = true; return; }
        if (view.tokens?.enabled === true) {
          allowance.replaceChildren(includedAllowance(view.tokens, view.usage.requests));
          allowanceHelp.hidden = true;
          return;
        }
        if (view.unlimited) {
          allowance.replaceChildren(el("strong", "", "Unlimited included AI"), el("p", "usage-note", "No ADCode token, request, or credit allowance. Provider availability and model context limits still apply."));
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
        if (!allowanceShown && (await signedOut) === true) { showSignIn(); return; }
        allowance.hidden = false;
        limitsEmpty.hidden = true;
        allowanceHelp.hidden = true;
        allowance.replaceChildren(el("span", "usage-note", "Your allowance could not be checked. Check your connection and try again."), button("Retry", "ad-btn ad-btn-tertiary", () => void refreshAllowance()));
      } finally {
        clearTimeout(slow);
      }
    }
    void refreshAllowance();
    allowanceTimer = setInterval(() => void refreshAllowance(), 15_000);

    // Range: Today / 7 days / 30 days / 90 days. View: Cost / Tokens / Limits.
    const toolbar = el("div", "usage-toolbar");
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
    const views = el("div", "ad-tabs usage-views");
    views.setAttribute("role", "radiogroup");
    views.setAttribute("aria-label", "Show");
    const VIEWS: readonly (readonly [UsageView, string])[] = [["cost", "Cost"], ["tokens", "Tokens"], ["limits", "Limits"]];
    const viewButtons = VIEWS.map(([value, label]) => {
      const item = button(label, "ad-tab usage-view", () => show(value));
      item.setAttribute("role", "radio");
      item.dataset["view"] = value;
      return item;
    });
    views.append(...viewButtons);
    views.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const at = VIEWS.findIndex(([value]) => value === view);
      const next = VIEWS[(at + (event.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length]![0];
      show(next);
      viewButtons.find((item) => item.dataset["view"] === next)?.focus();
    });
    toolbar.append(tabs, views);
    const slideRange = segmentIndicator(tabs, "[aria-selected=\"true\"]");
    const slideView = segmentIndicator(views, "[aria-checked=\"true\"]");

    const lead = el("p", "usage-lead", "Counted on this computer for the range and filters above. Costs are estimates at list prices, not a bill.");
    const body = el("div", "usage-body");
    body.id = "ai-usage-panel";
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-live", "polite");
    const limits = el("section", "usage-limits");
    limits.setAttribute("aria-label", "Limits");
    const limitsLead = el("div", "usage-panel-head");
    const limitsTitles = el("div", "usage-panel-titles");
    limitsTitles.append(el("h3", "usage-panel-title", "Limits"), el("p", "usage-panel-note", "How much of ADCode's included AI you have left, and when it refills."));
    limitsLead.append(limitsTitles);
    limits.append(limitsLead, allowance, limitsEmpty, paidWallet, allowanceHelp);
    const footer = el("div", "usage-footer");
    const clear = button("Clear usage", "ghost-button usage-clear", () => void clearAll());
    const close = button("Done", "ad-btn ad-btn-primary", () => finish());
    footer.append(clear, button("About your AI use", "ad-btn ad-btn-tertiary", () => void openAudienceProfile()), close);
    /*
     * One scrolling area for everything but the header and footer, so the page never scrolls
     * inside a strip (reported 2 November 2026). The range and view switch stay pinned.
     */
    const scroller = el("div", "usage-scroll");
    scroller.append(toolbar, limits, body);
    card.append(head, scroller, footer);

    function paintControls(): void {
      dialog.dataset["view"] = view;
      for (const tab of tabButtons) {
        const on = tab.dataset["range"] === range;
        tab.setAttribute("aria-selected", String(on));
        tab.id = `ai-usage-range-${tab.dataset["range"]!}`;
        tab.setAttribute("aria-controls", body.id);
        if (on) body.setAttribute("aria-labelledby", tab.id);
        tab.tabIndex = on ? 0 : -1;
      }
      for (const item of viewButtons) {
        const on = item.dataset["view"] === view;
        item.setAttribute("aria-checked", String(on));
        item.tabIndex = on ? 0 : -1;
      }
      limits.hidden = view !== "limits";
      body.hidden = view === "limits";
      tabs.hidden = view === "limits";
      slideRange();
      slideView();
    }

    /** A main process from before the page existed sends no `page`; draw it as empty rather than fail. */
    const pageOf = (current: AnalysedUsageView): UsagePageView => (current as Partial<AnalysedUsageView>).page ?? usagePage([], range, Date.now());

    function paintFilters(current: AnalysedUsageView): void {
      const page = pageOf(current);
      const fill = (select: HTMLSelectElement, all: string, choices: readonly { readonly id: string; readonly requests: number }[], chosen: string | null, label: (id: string) => string): void => {
        const list = chosen !== null && !choices.some((choice) => choice.id === chosen) ? [...choices, { id: chosen, requests: 0 }] : choices;
        const allOption = el("option", "", all);
        allOption.value = "";
        select.replaceChildren(allOption, ...list.map((choice) => {
          const option = el("option", "", label(choice.id));
          option.value = choice.id;
          option.title = choice.id;
          return option;
        }));
        select.value = chosen ?? "";
        select.disabled = list.length === 0;
      };
      fill(projectSelect, "All projects", page.projects, filter.project, projectName);
      fill(providerSelect, "All providers", page.providers, filter.provider, nameOf);
      projectSelect.title = page.projects.length === 0 ? "Projects are recorded from this version on" : "";
    }

    function paint(current: AnalysedUsageView): void {
      last = current;
      paintFilters(current);
      const focusedDay = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["day"] : undefined;
      const day = body.querySelector<HTMLElement>('.usage-calendar-cell[tabindex="0"]')?.dataset["day"];
      const scrollLeft = body.querySelector<HTMLElement>(".usage-calendar-scroll")?.scrollLeft;
      const scrollTop = scroller.scrollTop;
      const activity = createUsageActivity(current.activity, { ...(day === undefined ? {} : { day }), ...(scrollLeft === undefined ? {} : { scrollLeft }) });
      clear.disabled = current.since === null;
      const page = pageOf(current);
      const key = `${range}:${view}`;
      const arriving = key !== entered;
      if (arriving) body.dataset["enter"] = "true"; else delete body.dataset["enter"];
      entered = key;
      let parts: HTMLElement[];
      if (page.totals.requests === 0) {
        const filtered = filter.project !== null || filter.provider !== null;
        const empty = el("div", "usage-empty");
        empty.append(
          el("strong", "", current.since === null ? "Nothing used yet" : filtered ? "Nothing for this filter" : "Nothing in this range"),
          el("p", "", current.since === null
            ? "Send a message in the chat or give an agent a task, and what it uses shows up here."
            : filtered ? "Pick All projects or All providers at the top to see more." : "Pick a longer range at the top, like 30 days, to see earlier use."),
        );
        parts = [empty, activity];
      } else {
        parts = [lead, usagePageTabs(page, {
          metric: view === "tokens" ? "tokens" : "cost",
          nameOf,
          providerSlot: (provider) => page.providers.findIndex((option) => option.id === provider),
          chatTitle: (id) => chatTitles.get(id) ?? null,
          projectName,
          prices,
          state,
          showTokens: () => show("tokens"),
          enter: arriving,
          showConversations: options.showConversations === undefined ? undefined : () => { finish(); options.showConversations?.(); },
          openChat: options.openChat === undefined ? undefined : (id: string) => { finish(); options.openChat?.(id); },
        }, activity)];
      }
      remember(SECTION_KEY, state.section);
      body.replaceChildren(...parts);
      scroller.scrollTop = scrollTop;
      if (focusedDay) body.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });
    }

    async function refresh(): Promise<void> {
      const mine = ++request;
      try {
        const current = await window.adcode.aiUsage.read(range, { project: filter.project, provider: filter.provider } satisfies UsageFilter);
        if (mine === request) paint(current);
      } catch {
        if (mine === request) body.replaceChildren(el("p", "usage-note", "Usage could not be read."), button("Try again", "ad-btn ad-btn-tertiary", () => void refresh()));
      }
    }

    function choose(next: UsageRange): void {
      range = next;
      remember(RANGE_KEY, next);
      paintControls();
      void refresh();
    }

    function show(next: UsageView): void {
      view = next;
      remember(VIEW_KEY, next);
      paintControls();
      if (last !== null && next !== "limits") paint(last);
    }

    /** Names, chat titles and prices make the page read better; it works without them. */
    async function loadContext(): Promise<void> {
      const [status, sessions] = await Promise.all([
        Promise.resolve().then(() => window.adcode.ai.status()).catch(() => null),
        Promise.resolve().then(() => window.adcode.chat.sessions()).catch(() => null),
      ]);
      for (const provider of status?.providers ?? []) names.set(provider.id, provider.id === "tagflow" ? "Included AI" : provider.displayName);
      for (const session of sessions ?? []) chatTitles.set(session.id, session.title);
      // Every listed price; the page compares only the models you actually used.
      prices = (status?.providers ?? []).flatMap((provider) => provider.models
        .filter((model) => typeof model.inputPrice === "number" && typeof model.outputPrice === "number" && model.free !== true && (model.inputPrice + model.outputPrice) > 0)
        .map((model) => ({ key: `${provider.id}\u0000${model.id}`, provider: provider.id, model: model.id, name: model.name, inputUsdPerMillion: model.inputPrice as number, outputUsdPerMillion: model.outputPrice as number })));
      if (last !== null && view !== "limits") paint(last);
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
    paintControls();
    requestAnimationFrame(() => { slideRange(); slideView(); });
    body.replaceChildren(el("p", "usage-note", "Loading…"));
    void refresh();
    void loadContext();
    (view === "limits" ? viewButtons.find((item) => item.dataset["view"] === view) : tabButtons.find((tab) => tab.dataset["range"] === range))?.focus();
  });
}

/** The account's single weekly balance, shared by every included model. */
function includedAllowance(paid: NonNullable<TagflowAllowanceView["tokens"]>, requestsToday: number): HTMLElement {
  const costCredits=paid.accounting==="cost-v1";
  const amount=costCredits?(value:number)=>(value/11000).toLocaleString("en-US",{maximumFractionDigits:2}):formatTokens;
  const unit=costCredits?"credits":"tokens";
  const fairUse=isFairUsePlan(paid.plan?.id);
  const now = Date.now();
  const split = el("div", "usage-split");
  const plan = aiPlanName(paid.plan, now);
  const free = paid.free;
  const used = Math.max(0, free.used + free.held);
  const heabsy = el("section", "usage-split-card");
  heabsy.dataset["kind"] = "included";
  heabsy.dataset["out"] = String(free.remaining <= 0 && (fairUse || paid.purchased <= 0));
  const progress = el("progress", "ad-progress");
  progress.max = Math.max(1, free.limit);
  progress.value = Math.min(free.limit, used);
  progress.setAttribute("aria-label", `Included AI ${unit} used today`);
  const refill = free.resetsAt === null ? "Your daily allowance starts with your first included AI request" : `Refills in ${untilText(free.resetsAt, now)}`;
  heabsy.append(
    el("span", "usage-split-name", plan === null ? "Included AI · Free" : `Included AI · ${plan} plan`),
    el("strong", "usage-split-value", `${percentLeft(free.remaining, free.limit)}% left`),
    progress,
    el("span", "usage-stat-detail", `${amount(used)} of ${amount(free.limit)} ${unit} today · ${refill}${fairUse ? " · daily fair-use limit; saved credits are not charged" : paid.purchased > 0 ? ` · then ${amount(paid.purchased)} purchased ${unit}` : ""}`),
  );
  const actions = el("div", "usage-split-actions");
  actions.append(
    button(plan === null ? "Upgrade plan" : "Manage plan", "ad-btn ad-btn-secondary", () => void window.open(`${BUY_TOKENS_URL}#plans`, "_blank", "noopener")),
    button(costCredits?"Buy credits":"Buy tokens", "ad-btn ad-btn-tertiary", () => void window.open(BUY_TOKENS_URL, "_blank", "noopener")),
  );
  heabsy.append(actions);
  heabsy.append(el("p", "usage-stat-detail", `Shared by Tagflow AI and all other included models · ${requestsToday.toLocaleString()} requests today`));
  split.append(heabsy);
  return split;
}
