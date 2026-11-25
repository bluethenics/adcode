/**
 * Usage → Coding CLIs: what Claude Code and Codex used, from their own history on this computer.
 *
 * T3 Code's Usage page reads the coding agents' transcripts rather than its own records, so it
 * counts work done anywhere - a terminal, another editor, ADCode. This view does the same and
 * keeps T3's honest framing: the cost is what the same tokens would cost at API list prices,
 * not the subscription bill. Codex's limits are its own last reading, dated.
 *
 * Pure DOM from a `CliUsageView`; the dialog owns reading and refreshing.
 */
import {
  CLI_USAGE_PROVIDERS,
  cacheHitRate,
  formatCliCost,
  formatCliTokens,
  formatResetIn,
  type CliUsageView,
} from "../../shared/cliUsage.ts";
import { button, el } from "../dialogs/formDialog.ts";

export interface CliUsageViewOptions {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly now?: number;
}

function stat(label: string, value: string, detail: string): HTMLElement {
  const box = el("div", "usage-stat cli-usage-stat");
  box.append(el("span", "usage-stat-label", label), el("strong", "usage-stat-value", value), el("span", "usage-stat-detail", detail));
  return box;
}

function percent(value: number | null): string {
  return value === null ? "-" : `${Math.round(value * 100).toString()}%`;
}

function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes.toString()} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours.toString()} h ago`;
  return `${Math.round(hours / 24).toString()} days ago`;
}

function limitsSection(view: CliUsageView, now: number): HTMLElement | null {
  if (view.limits.length === 0) return null;
  const section = el("section", "cli-usage-limits");
  section.setAttribute("aria-label", "Subscription limits");
  section.append(el("h4", "cli-usage-heading", "Subscription limits"));
  for (const limits of view.limits) {
    const card = el("div", "cli-usage-limit-card");
    const name = CLI_USAGE_PROVIDERS[limits.provider];
    const plan = limits.plan === null ? "" : ` · ${limits.plan.charAt(0).toUpperCase()}${limits.plan.slice(1)} plan`;
    card.append(el("div", "cli-usage-limit-title", `${name}${plan}`));
    for (const window of limits.windows) {
      const refilled = window.resetsAt !== null && window.resetsAt <= now;
      const left = refilled ? 100 : Math.max(0, 100 - window.usedPercent);
      const row = el("div", "cli-usage-limit-row");
      const meter = document.createElement("progress");
      meter.className = "cli-usage-limit-meter";
      meter.max = 100;
      meter.value = left;
      meter.setAttribute("aria-label", `${name} ${window.label} limit: ${Math.round(left).toString()}% left`);
      if (left <= 10) meter.dataset["low"] = "true";
      const when = refilled
        ? "refilled since this reading"
        : window.resetsAt === null ? "reset time not reported" : `resets ${formatResetIn(window.resetsAt, now)}`;
      row.append(
        el("span", "cli-usage-limit-label", window.label),
        meter,
        el("span", "cli-usage-limit-value", `${Math.round(left).toString()}% left`),
        el("span", "cli-usage-limit-when", when),
      );
      card.append(row);
    }
    card.append(el("p", "usage-note", `As of Codex's last request, ${ago(limits.observedAt, now)}. It updates whenever Codex runs.`));
    section.append(card);
  }
  return section;
}

function dailyChart(view: CliUsageView): HTMLElement | null {
  if (view.daily.length < 2) return null;
  const peak = Math.max(1, ...view.daily.map((day) => day.costMicros > 0 ? day.costMicros : day.tokens / 1000));
  const chart = el("div", "cli-usage-chart");
  chart.setAttribute("role", "img");
  const busiest = [...view.daily].sort((a, b) => b.costMicros - a.costMicros || b.tokens - a.tokens)[0];
  chart.setAttribute("aria-label", busiest === undefined || busiest.requests === 0
    ? "No coding CLI use in this range"
    : `Daily coding CLI use. Busiest day ${busiest.day}: ${formatCliCost(busiest.costMicros)}, ${formatCliTokens(busiest.tokens)} tokens.`);
  for (const day of view.daily) {
    const bar = el("span", "cli-usage-bar");
    const value = day.costMicros > 0 ? day.costMicros : day.tokens / 1000;
    bar.style.setProperty("--bar", `${Math.max(day.requests > 0 ? 3 : 0, Math.round((value / peak) * 100)).toString()}%`);
    bar.title = `${day.day}: ${formatCliCost(day.costMicros)} · ${formatCliTokens(day.tokens)} tokens · ${day.requests.toLocaleString()} requests`;
    chart.append(bar);
  }
  return chart;
}

function modelsTable(view: CliUsageView): HTMLElement {
  const wrap = el("div", "cli-usage-table-wrap");
  const table = document.createElement("table");
  table.className = "cli-usage-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Model", "Requests", "Input", "Cache read", "Cache write", "Output", "Cache hit", "Est. cost"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of view.models) {
    const tr = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.append(el("span", "cli-usage-model", row.model), el("span", "cli-usage-provider", CLI_USAGE_PROVIDERS[row.provider]));
    tr.append(name);
    const cells = [
      row.requests.toLocaleString(),
      formatCliTokens(row.input),
      formatCliTokens(row.cacheRead),
      formatCliTokens(row.cacheWrite),
      formatCliTokens(row.output),
      percent(cacheHitRate(row)),
      row.priced ? formatCliCost(row.costMicros) : "No price",
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    if (!row.priced) tr.title = "ADCode's model list has no price for this model, so its tokens count but its cost does not.";
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function sourcesList(view: CliUsageView): HTMLElement {
  const details = el("details", "cli-usage-sources");
  details.append(el("summary", "", "Where this was read"));
  const list = el("ul", "cli-usage-source-list");
  for (const source of view.sources) {
    const state = !source.found ? "not on this computer" : `${source.files.toLocaleString()} file${source.files === 1 ? "" : "s"} from the last 90 days${source.failed > 0 ? `, ${source.failed.toString()} could not be read` : ""}`;
    list.append(el("li", "", `${CLI_USAGE_PROVIDERS[source.provider]}: ${source.location} - ${state}`));
  }
  details.append(
    list,
    el("p", "usage-note", "Only these folders are read, and only read: nothing is changed or sent anywhere. CLAUDE_CONFIG_DIR and CODEX_HOME are honoured. Claude Code deletes its own transcripts after 30 days by default, so older Claude use may be missing."),
  );
  return details;
}

/** The whole Coding CLIs panel for one reading. */
export function renderCliUsage(view: CliUsageView, options: CliUsageViewOptions): HTMLElement {
  const now = options.now ?? Date.now();
  const panel = el("section", "cli-usage");
  panel.setAttribute("aria-label", "Coding CLI usage");
  const head = el("div", "usage-panel-head");
  const titles = el("div", "usage-panel-titles");
  titles.append(
    el("h3", "usage-panel-title", "Coding CLIs"),
    el("p", "usage-panel-note", "Claude Code and Codex, read from the history they keep on this computer - including work done outside ADCode."),
  );
  const refresh = button(options.refreshing ? "Reading…" : "Refresh", "ad-btn ad-btn-tertiary cli-usage-refresh", () => options.onRefresh());
  refresh.disabled = options.refreshing;
  refresh.title = "Read the CLIs' history again";
  head.append(titles, refresh);
  panel.append(head);

  const limits = limitsSection(view, now);
  if (view.totals.requests === 0) {
    const anyFound = view.sources.some((source) => source.found);
    const empty = el("div", "usage-empty");
    empty.append(
      el("strong", "", anyFound ? "No coding CLI use in this range" : "No Claude Code or Codex history found"),
      el("p", "", anyFound
        ? "Pick a longer range above, or run Claude Code or Codex - in a terminal or as ADCode's model - and its use shows up here."
        : "Install Claude Code or Codex and use it once; ADCode reads their history from this computer. Connect one as ADCode's model from Connect a model."),
    );
    panel.append(empty);
    if (limits !== null) panel.append(limits);
    panel.append(sourcesList(view));
    return panel;
  }

  const totals = view.totals;
  const stats = el("div", "usage-stats cli-usage-stats");
  stats.append(
    stat("Est. API cost", formatCliCost(totals.costMicros), totals.unpricedRequests > 0 ? `${totals.unpricedRequests.toLocaleString()} requests on unpriced models not included` : "at list prices, not your subscription bill"),
    stat("Tokens", formatCliTokens(totals.tokens), `${formatCliTokens(totals.output)} written · ${formatCliTokens(totals.input + totals.cacheRead + totals.cacheWrite)} read`),
    stat("Cache saved", formatCliCost(totals.cacheSavedMicros), `${percent(cacheHitRate(totals))} of input came from the cache`),
    stat("Requests", totals.requests.toLocaleString(), `${view.sessions.toLocaleString()} session${view.sessions === 1 ? "" : "s"}`),
  );
  panel.append(stats);
  if (limits !== null) panel.append(limits);

  const providers = el("div", "cli-usage-providers");
  for (const row of view.providers) {
    const item = el("div", "cli-usage-provider-row");
    item.append(
      el("strong", "", CLI_USAGE_PROVIDERS[row.provider]),
      el("span", "", `${formatCliCost(row.costMicros)} · ${formatCliTokens(row.tokens)} tokens · ${row.requests.toLocaleString()} requests · ${row.sessions.toLocaleString()} sessions`),
    );
    providers.append(item);
  }
  panel.append(providers);
  const chart = dailyChart(view);
  if (chart !== null) panel.append(chart);
  panel.append(el("h4", "cli-usage-heading", "By model"), modelsTable(view), sourcesList(view));
  panel.append(el("p", "usage-note", `Read ${ago(view.scannedAt, now)}. Fast-mode premiums are not added; reasoning tokens are part of output.`));
  return panel;
}
