/**
 * The Usage page's Cost and Tokens views: the sections under the filters, drawn from one
 * `UsagePageView` (shared/usagePage.ts).
 *
 * Four tabs, most useful first: Overview (the total, a row per provider and a smoothed chart,
 * as on T3 Code's Usage page, plus the everyday figures), Your models (a card for each model
 * actually used, and a comparison between them), When and where (busiest hours, costliest
 * chats, the past year) and Details (totals, the split by type, a table by model or day).
 *
 * Every section has a title and one plain line saying what it shows. Where the data cannot
 * say something, the section says so and what to do, instead of drawing a zero.
 */
import { formatTokens, formatUsageCost } from "../../shared/aiUsage.ts";
import { formatDuration } from "../../shared/usageInsights.ts";
import { trendArrow, usageSummary, weekdayOf, whatIfCostMicros, type UsagePageModel, type UsagePageView } from "../../shared/usagePage.ts";
import { countUp, segmentIndicator } from "./usageMotion.ts";
import { hourBars, hourMap, html, longDay, providerChart, seriesClass, shortDay, typeBar } from "./usageCharts.ts";

export type UsageMetric = "cost" | "tokens";

/** Choices on the page that survive a live refresh. */
export interface UsagePageState {
  breakdown: "model" | "day";
  whatIf: string | null;
  section: UsageSection;
  /** Model cards opened for their details. */
  readonly expanded: Set<string>;
}

/** A model with a list price, from the catalogue, for comparing the models you used. */
export interface PricedModel {
  /** provider + NUL + model id, as usage rows name it. */
  readonly key: string;
  readonly provider: string;
  /** The model id, as usage rows name it. */
  readonly model: string;
  readonly name: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

export interface UsagePageDeps {
  readonly metric: UsageMetric;
  readonly nameOf: (provider: string) => string;
  /** Colour slot for a provider, fixed for the range whatever the filter. */
  readonly providerSlot: (provider: string) => number;
  readonly chatTitle: (id: string) => string | null;
  readonly projectName: (path: string) => string;
  readonly prices: readonly PricedModel[];
  /** Mutable choices that survive a live refresh. */
  readonly state: UsagePageState;
  readonly showTokens: () => void;
  readonly showConversations?: (() => void) | undefined;
  /** Opens one chat; offered only for chats in the open project, the ones the chat can resume. */
  readonly openChat?: ((id: string) => void) | undefined;
  /** The page just arrived (opened, or a new range, view or filter): numbers count up and sections stagger in. */
  readonly enter: boolean;
}

/** Number a list's items for the CSS stagger; past eight they all arrive together. */
function stagger(items: Iterable<Element>): void {
  let index = 0;
  for (const item of items) (item as HTMLElement).style.setProperty("--i", String(Math.min(8, index++)));
}

/**
 * Pointing at a provider or model row lights that provider's series in the chart and dims
 * the rest; leaving the row puts them back.
 */
function linkHighlight(root: HTMLElement, chart: HTMLElement = root): void {
  const mark = (provider: string | null): void => {
    for (const node of chart.querySelectorAll<HTMLElement | SVGElement>(".usage-area-layer, .usage-key")) {
      const own = node.getAttribute("data-provider");
      if (provider === null || own === provider) node.removeAttribute("data-dim"); else node.setAttribute("data-dim", "true");
    }
  };
  root.addEventListener("pointerover", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-series-row]");
    mark(row?.dataset["seriesRow"] ?? null);
  });
  root.addEventListener("pointerleave", () => mark(null));
  root.addEventListener("focusin", (event) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-series-row]");
    if (row !== null) mark(row.dataset["seriesRow"] ?? null);
  });
}

export function section(title: string, note: string, ...content: (HTMLElement | null)[]): HTMLElement {
  const box = html("section", "usage-panel");
  const head = html("header", "usage-panel-head");
  const text = html("div", "usage-panel-titles");
  text.append(html("h3", "usage-panel-title", title), html("p", "usage-panel-note", note));
  head.append(text);
  box.append(head, ...content.filter((part): part is HTMLElement => part !== null));
  return box;
}

export function emptyNote(title: string, body: string): HTMLElement {
  const box = html("div", "usage-panel-empty");
  box.append(html("strong", "", title), html("p", "", body));
  return box;
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const percent = (share: number): string => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100).toString()}%`);

/** A provider's mark: its initial on its series colour, since providers ship no icons ADCode may draw. */
function providerMark(name: string, slot: number): HTMLElement {
  const mark = html("span", `usage-provider-mark ${seriesClass(slot)}`, (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase());
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

function hero(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const totals = page.totals;
  const cost = deps.metric === "cost";
  const box = html("div", "usage-hero");
  const top = html("div", "usage-hero-total");
  const value = cost ? (totals.costMicros === null ? "No price" : `${formatUsageCost(totals.costMicros)}${totals.costPartial ? "+" : ""}`) : `${totals.estimated ? "≈ " : ""}${formatTokens(totals.processedTokens)}`;
  top.append(html("strong", "usage-hero-value", value));
  const trend = trendArrow(cost ? page.trend.costMicros : page.trend.tokens);
  if (trend !== "") {
    const chip = html("span", "usage-trend-chip", `${trend} vs before`);
    const up = (cost ? page.trend.costMicros : page.trend.tokens) ?? 0;
    chip.dataset["tone"] = up > 0 ? "up" : up < 0 ? "down" : "flat";
    chip.title = `Against the ${page.range === "today" ? "day" : `${page.days.length.toString()} days`} before`;
    top.append(chip);
  }
  const parts = [
    ...(totals.chats > 0 ? [plural(totals.chats, "chat")] : []),
    plural(totals.requests, "request"),
    cost ? (totals.costMicros === null ? "no list price for these models" : "estimate at list prices") : totals.estimated ? "some counts estimated" : "counted by the providers",
  ];
  box.append(top, html("p", "usage-hero-sub", parts.join(" · ")));
  if (cost && totals.costMicros === null) {
    const empty = emptyNote("No cost to show", "None of the models used here has a price in ADCode's list, so there is nothing to add up. The Tokens view shows how much they were used.");
    const action = html("button", "ad-btn ad-btn-secondary", "Show tokens");
    action.type = "button";
    action.addEventListener("click", deps.showTokens);
    empty.append(action);
    box.append(empty);
  }

  const list = html("ul", "usage-providers");
  list.setAttribute("aria-label", "Use by provider");
  for (const provider of page.providerRows) {
    const share = cost ? provider.costShare : provider.tokenShare;
    const row = html("li", `usage-provider ${seriesClass(deps.providerSlot(provider.id))}`);
    row.dataset["seriesRow"] = provider.id;
    const name = html("div", "usage-provider-name");
    const label = html("strong", "", deps.nameOf(provider.id));
    label.title = deps.nameOf(provider.id);
    name.append(label, html("span", "", provider.chats > 0 ? `${plural(provider.chats, "chat")} · ${plural(provider.requests, "request")}` : plural(provider.requests, "request")));
    const bar = html("div", "usage-provider-share");
    const track = html("span", "usage-share-track");
    track.setAttribute("aria-hidden", "true");
    const fill = html("span", "usage-share-fill");
    fill.style.setProperty("--share", `${Math.max(share > 0 ? 2 : 0, Math.round(share * 100)).toString()}%`);
    track.append(fill);
    bar.append(track, html("span", "usage-provider-percent", percent(share)));
    const tokens = html("span", "usage-provider-tokens", formatTokens(provider.tokens));
    tokens.title = `${provider.tokens.toLocaleString()} tokens`;
    const money = html("span", "usage-provider-cost", provider.costMicros === null ? "No price" : `${formatUsageCost(provider.costMicros)}${provider.costPartial ? "+" : ""}`);
    if (provider.costMicros === null) money.title = "ADCode's model list has no price for this provider's models.";
    row.append(providerMark(deps.nameOf(provider.id), deps.providerSlot(provider.id)), name, bar, tokens, money);
    list.append(row);
  }
  stagger(list.children);
  box.append(list);
  return box;
}

function chartPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const cost = deps.metric === "cost" && page.totals.costMicros !== null;
  const note = cost ? "What each provider cost, day by day. Point at a day to see the numbers." : "How many tokens each provider used, day by day. Point at a day to see the numbers.";
  if (page.days.length < 2) {
    // One day is not a line: show its hours instead, from the hour each request was made.
    const today = page.days[0];
    const hours = today === undefined ? [] : page.hours.grid[weekdayOf(today.day)] ?? [];
    if (hours.every((count) => count === 0)) return section("Over time", note, emptyNote("One day is not a line yet", "Pick 7 days or longer at the top to see how your use moves day by day."));
    return section("Today by hour", "How many requests you made in each hour today. Pick 7 days or longer for a chart over days.", hourBars(hours));
  }
  return section("Over time", note, providerChart({ days: page.days, series: page.series, metric: cost ? "cost" : "tokens", nameOf: deps.nameOf, colourOf: (provider) => seriesClass(deps.providerSlot(provider)) }));
}

function tile(label: string, value: string, detail: string, tone = ""): HTMLElement {
  const box = html("div", "usage-tile");
  if (tone !== "") box.dataset["tone"] = tone;
  box.append(html("span", "usage-tile-label", label), html("strong", "usage-tile-value", value), html("span", "usage-tile-detail", detail));
  return box;
}

function totalsPanel(page: UsagePageView): HTMLElement {
  const totals = page.totals;
  const grid = html("div", "usage-tiles");
  const saving = totals.cacheSavedMicros === null
    ? tile("Cache savings", "Not known", totals.cachedTokens === 0 ? "Nothing was read from a cache" : "These models have no cache price in ADCode's list")
    : tile("Cache savings", `${formatUsageCost(totals.cacheSavedMicros)}${totals.cacheSavedPartial ? "+" : ""}`, "Saved by reading from the cache instead of paying full price", "good");
  grid.append(
    tile("Processed tokens", formatTokens(totals.processedTokens), "Everything the AI read and wrote"),
    tile("Cached input", formatTokens(totals.cachedTokens), "Read again from the provider's cache: cheaper"),
    tile("Uncached input", formatTokens(totals.uncachedTokens), "Read fresh at full price"),
    tile("Output", formatTokens(totals.outputTokens), "What the AI wrote back"),
    saving,
  );
  return section("Totals", "The same use counted four ways, and what the cache saved you.", grid);
}

function typePanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const cacheWrite = { key: "write", label: "Cache write", value: null, missing: "Not reported", hint: "Providers do not tell ADCode this" } as const;
  if (deps.metric === "cost") {
    const split = page.costByType;
    if (split === null) return section("Cost by type", "What the money paid for: reading, reading from cache, and writing.", emptyNote("No cost to split", "None of these models has a price in ADCode's list."));
    const parts = [
      { key: "input", label: "Input", value: split.input, hint: "Reading your messages, files and tools fresh" },
      { key: "cache", label: "Cache read", value: split.cacheRead, hint: "Re-reading the same context from the cache" },
      cacheWrite,
      { key: "output", label: "Output", value: split.output, hint: "Writing answers and code" },
      ...(split.unsplit > 0 ? [{ key: "unsplit", label: "Not split", value: split.unsplit, hint: "Recorded before ADCode kept the split" }] : []),
    ];
    return section("Cost by type", "What the money paid for: reading, reading from cache, and writing.", typeBar(parts, formatUsageCost, "Cost by type"));
  }
  const split = page.tokensByType;
  return section("Tokens by type", "What the tokens were: reading, reading from cache, and writing.", typeBar([
    { key: "input", label: "Input", value: split.input, hint: "Read fresh at full price" },
    { key: "cache", label: "Cache read", value: split.cacheRead, hint: "Read again from the cache, for less" },
    cacheWrite,
    { key: "output", label: "Output", value: split.output, hint: "Written by the AI" },
  ], formatTokens, "Tokens by type"));
}

function breakdownPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const cost = deps.metric === "cost" && page.totals.costMicros !== null;
  const toggle = html("div", "usage-mini-toggle");
  toggle.setAttribute("role", "radiogroup");
  toggle.setAttribute("aria-label", "Break down by");
  const body = html("div", "usage-breakdown-body");
  const options = [["model", "Model"], ["day", "Day"]] as const;
  const buttons = options.map(([value, label]) => {
    const item = html("button", "usage-mini-option", label);
    item.type = "button";
    item.setAttribute("role", "radio");
    item.dataset["value"] = value;
    item.addEventListener("click", () => { deps.state.breakdown = value; paint(); });
    return item;
  });
  toggle.append(...buttons);
  const slide = segmentIndicator(toggle, "[aria-checked=\"true\"]");
  toggle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    deps.state.breakdown = deps.state.breakdown === "model" ? "day" : "model";
    paint();
    buttons.find((item) => item.dataset["value"] === deps.state.breakdown)?.focus();
  });

  function paint(): void {
    for (const item of buttons) {
      const on = item.dataset["value"] === deps.state.breakdown;
      item.setAttribute("aria-checked", String(on));
      item.tabIndex = on ? 0 : -1;
    }
    slide();
    const table = html("table", "usage-breakdown");
    const head = html("thead", "");
    const headRow = html("tr", "");
    for (const label of [deps.state.breakdown === "model" ? "Model" : "Day", "Cost", "Share", "Tokens", "Requests"]) {
      const cell = html("th", "", label);
      cell.scope = "col";
      headRow.append(cell);
    }
    head.append(headRow);
    const rows = html("tbody", "");
    if (deps.state.breakdown === "model") {
      page.models.forEach((model, index) => {
        const row = html("tr", seriesClass(index));
        row.dataset["seriesRow"] = model.provider;
        const name = html("th", "usage-breakdown-name");
        name.scope = "row";
        name.title = `${deps.nameOf(model.provider)} · ${model.model}`;
        name.append(html("span", "usage-breakdown-label", model.model), html("span", "usage-breakdown-sub", deps.nameOf(model.provider)));
        row.append(name, html("td", "", model.costMicros === null ? "No price" : `${formatUsageCost(model.costMicros)}${model.costPartial ? "+" : ""}`), html("td", "", percent(cost ? model.costShare : model.tokenShare)),
          html("td", "", `${model.estimated ? "≈ " : ""}${formatTokens(model.tokens)}`), html("td", "", model.requests.toLocaleString()));
        rows.append(row);
      });
    } else {
      const total = cost ? page.totals.costMicros ?? 0 : page.totals.processedTokens;
      for (const day of [...page.days].reverse()) {
        if (day.requests === 0) continue;
        const row = html("tr", "usage-breakdown-day");
        const name = html("th", "usage-breakdown-name");
        name.scope = "row";
        name.append(html("span", "usage-breakdown-label", longDay(day.day)));
        row.append(name, html("td", "", day.costMicros === 0 && page.totals.costMicros === null ? "No price" : formatUsageCost(day.costMicros)),
          html("td", "", percent(total === 0 ? 0 : (cost ? day.costMicros : day.tokens) / total)), html("td", "", formatTokens(day.tokens)), html("td", "", day.requests.toLocaleString()));
        rows.append(row);
      }
    }
    stagger(rows.children);
    table.append(head, rows);
    const scroll = html("div", "usage-breakdown-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Breakdown table");
    scroll.append(table);
    body.replaceChildren(scroll);
  }
  paint();
  const box = section("Breakdown", "Each model, or each day, with its cost, its share and its tokens.", body);
  box.querySelector(".usage-panel-head")!.append(toggle);
  return box;
}

function factsPanel(page: UsagePageView): HTMLElement {
  const grid = html("div", "usage-tiles usage-tiles-four");
  const perRequestTrend = trendArrow(page.trend.tokensPerRequest);
  const up = page.trend.tokensPerRequest ?? 0;
  grid.append(
    tile("Cost per request", page.perRequest.costMicros === null ? "No price" : formatUsageCost(page.perRequest.costMicros), "One request is one ask to the AI. A chat message can make several."),
    page.perChat === null
      ? tile("Cost per chat", "Not yet", "Chats are counted from this version on. Chat with the AI and this fills in.")
      : tile("Cost per chat", page.perChat.costMicros === null ? "No price" : formatUsageCost(page.perChat.costMicros), `An average chat: ${formatTokens(page.perChat.tokens)} tokens over ${plural(page.perChat.requests, "request")}`),
    tile("Tokens per request", `${formatTokens(page.perRequest.tokens)}${perRequestTrend === "" ? "" : ` ${perRequestTrend}`}`, perRequestTrend === "" ? "Nothing earlier to compare with" : "Against the period before. Bigger requests usually mean longer chats.", perRequestTrend === "" ? "" : up > 0.05 ? "up" : up < -0.05 ? "down" : ""),
    tile("Cache hit rate", percent(page.totals.cacheHitRate), page.totals.cachedTokens === 0 ? "Nothing came from a cache yet" : "Of everything the AI read came from its cache"),
  );
  return section("Good to know", "The numbers behind the bill, in everyday terms.", grid);
}

function hoursPanel(page: UsagePageView): HTMLElement {
  const note = "When you use AI most: darker squares are busier hours.";
  if (page.hours.recorded === 0) {
    return section("Busiest hours", note, emptyNote("No hours recorded yet", "ADCode starts noting the hour of each request from this version. Use the AI for a day or two and the map fills in."));
  }
  return section("Busiest hours", note, hourMap(page.hours.grid));
}

function chatsPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const note = deps.metric === "cost" ? "The chats that cost the most in this period." : "The chats that used the most in this period.";
  const open = deps.showConversations;
  const action = open === undefined ? null : (() => {
    const item = html("button", "ad-btn ad-btn-tertiary usage-panel-action", "Open chat list");
    item.type = "button";
    item.addEventListener("click", open);
    return item;
  })();
  if (page.chats.length === 0) {
    return section("Most expensive chats", note, emptyNote("No chats counted yet", "ADCode counts chats from this version on. Send a message in the chat and it shows up here."));
  }
  const list = html("ol", "usage-chats");
  const top = Math.max(1, ...page.chats.map((chat) => (deps.metric === "cost" ? chat.costMicros ?? 0 : chat.tokens)));
  for (const chat of page.chats) {
    const item = html("li", "usage-chat");
    const known = deps.chatTitle(chat.id);
    const title = known ?? `Chat from ${shortDay(chat.firstDay)}`;
    const openChat = deps.openChat;
    // A chat in this project opens straight from its row; one from another project has no conversation to resume here.
    const text = openChat !== undefined && known !== null ? html("button", "usage-chat-text usage-chat-open") : html("div", "usage-chat-text");
    if (text instanceof HTMLButtonElement && openChat !== undefined) {
      text.type = "button";
      text.addEventListener("click", () => openChat(chat.id));
    }
    const name = html("strong", "", title);
    name.title = title;
    const where = [chat.project === null ? null : deps.projectName(chat.project), chat.model, plural(chat.requests, "request")].filter((part): part is string => part !== null && part !== "");
    text.append(name, html("span", "", where.join(" · ")));
    if (text instanceof HTMLButtonElement) text.setAttribute("aria-label", `Open the chat ${title}, ${where.join(", ")}`);
    const value = html("span", "usage-chat-value", deps.metric === "cost" ? (chat.costMicros === null ? formatTokens(chat.tokens) : formatUsageCost(chat.costMicros)) : formatTokens(chat.tokens));
    const bar = html("span", "usage-chat-bar");
    bar.setAttribute("aria-hidden", "true");
    bar.style.setProperty("--share", `${Math.max(2, Math.round(((deps.metric === "cost" ? chat.costMicros ?? 0 : chat.tokens) / top) * 100)).toString()}%`);
    item.append(text, value, bar);
    list.append(item);
  }
  stagger(list.children);
  const box = section("Most expensive chats", note, list);
  if (action !== null) box.querySelector(".usage-panel-head")!.append(action);
  return box;
}

const modelKey = (model: { readonly provider: string; readonly model: string }): string => `${model.provider}\u0000${model.model}`;

/** Most expensive first; models with no price after, by tokens. */
function byCost(models: readonly UsagePageModel[]): UsagePageModel[] {
  return [...models].sort((a, b) => (b.costMicros ?? -1) - (a.costMicros ?? -1) || b.tokens - a.tokens || a.model.localeCompare(b.model));
}

function figure(label: string, value: string): HTMLElement {
  const box = html("div", "usage-model-figure");
  box.append(html("span", "", label), html("b", "", value));
  return box;
}

/** One model the person used: the headline figures, and the rest a click away. */
function modelCard(model: UsagePageModel, slot: number, cost: boolean, deps: UsagePageDeps): HTMLElement {
  const key = modelKey(model);
  const card = html("li", `usage-model-card ${seriesClass(slot)}`);
  const open = deps.state.expanded.has(key);
  const head = html("button", "usage-model-head");
  head.type = "button";
  head.setAttribute("aria-expanded", String(open));
  const name = html("div", "usage-model-title");
  const label = html("strong", "", model.model);
  label.title = `${model.model} · ${deps.nameOf(model.provider)}`;
  name.append(html("i", "usage-swatch"), label, html("span", "", deps.nameOf(model.provider)));
  const share = cost ? model.costShare : model.tokenShare;
  const money = html("span", "usage-model-cost", model.costMicros === null ? "No price" : `${formatUsageCost(model.costMicros)}${model.costPartial ? "+" : ""}`);
  const track = html("span", "usage-share-track usage-model-share");
  track.setAttribute("aria-hidden", "true");
  const fill = html("span", "usage-share-fill");
  fill.style.setProperty("--share", `${Math.max(share > 0 ? 2 : 0, Math.round(share * 100)).toString()}%`);
  track.append(fill);
  const chevron = html("span", "usage-model-chevron");
  chevron.setAttribute("aria-hidden", "true");
  const figures = html("div", "usage-model-figures");
  const cacheRate = model.inputTokens === 0 ? 0 : model.cachedTokens / model.inputTokens;
  figures.append(
    figure("Requests", model.requests.toLocaleString()),
    figure("Tokens", `${model.estimated ? "≈ " : ""}${formatTokens(model.tokens)}`),
    figure("Per request", model.costPerRequestMicros === null ? "No price" : formatUsageCost(model.costPerRequestMicros)),
    figure("Share", percent(share)),
    figure("From cache", percent(cacheRate)),
    figure("Speed", model.tokensPerSecond === null ? "Not timed yet" : `${model.tokensPerSecond.toLocaleString()} tok/s`),
  );
  head.append(name, money, chevron, track, figures);
  const details = html("div", "usage-model-details");
  details.hidden = !open;
  details.append(
    figure("Read fresh", formatTokens(model.inputTokens - model.cachedTokens)),
    figure("Read from cache", formatTokens(model.cachedTokens)),
    figure("Written", formatTokens(model.outputTokens)),
    figure("Tokens per request", formatTokens(model.tokensPerRequest)),
    figure("Average answer", model.averageResponseMs === null ? "Not timed yet" : formatDuration(model.averageResponseMs)),
    figure("Timed answers", model.timedRequests.toLocaleString()),
  );
  if (model.estimated) details.append(html("p", "usage-panel-note", "Some of these counts are ADCode's estimates, because the provider did not report them."));
  head.addEventListener("click", () => {
    const now = details.hidden;
    details.hidden = !now;
    head.setAttribute("aria-expanded", String(now));
    if (now) deps.state.expanded.add(key); else deps.state.expanded.delete(key);
  });
  card.append(head, details);
  return card;
}

function modelsPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const cost = deps.metric === "cost" && page.totals.costMicros !== null;
  const sorted = byCost(page.models);
  const list = html("ul", "usage-model-cards");
  list.setAttribute("aria-label", "Your models");
  // Each model keeps the colour it has in the breakdown table, whatever the order here.
  for (const model of sorted) list.append(modelCard(model, page.models.indexOf(model), cost, deps));
  stagger(list.children);
  const { fastest, slowest } = page.speed;
  const speed = fastest === null
    ? html("p", "usage-panel-note usage-speed-line", "Speed shows up once a model has answered three timed requests.")
    : html("p", "usage-speed-line", slowest === null
      ? `Fastest: ${fastest.model}, ${(fastest.tokensPerSecond ?? 0).toLocaleString()} tokens a second, a whole answer in ${formatDuration(fastest.averageResponseMs)}.`
      : `Fastest: ${fastest.model} at ${(fastest.tokensPerSecond ?? 0).toLocaleString()} tokens a second. Slowest: ${slowest.model} at ${(slowest.tokensPerSecond ?? 0).toLocaleString()}.`);
  return section("Your models", "Every model you used in this period, most expensive first. Select one for its details.", speed, list);
}

function whatIfPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement {
  const note = "What all of this period's tokens would cost on another model you have used.";
  const used = new Set(page.models.map(modelKey));
  const priced = deps.prices.filter((model) => used.has(modelKey(model)));
  if (priced.length < 2) {
    return section("Compare your models", note, emptyNote(
      priced.length === 0 ? "None of your models has a known price" : "Only one of your models has a known price",
      priced.length === 0
        ? "ADCode's model list has no price for the models you used here, so there is nothing to compare."
        : "Comparing needs two models with a price. Use another priced model for a while and you can compare them here.",
    ));
  }
  const select = html("select", "ad-input ad-select usage-whatif-select");
  select.setAttribute("aria-label", "Model to compare with");
  for (const model of priced) {
    const option = html("option", "", `${model.name} (${deps.nameOf(model.provider)})`);
    option.value = model.key;
    select.append(option);
  }
  // Start on the cheapest one you used: the likeliest question is "could I have spent less?"
  const cheapest = [...priced].sort((a, b) => a.inputUsdPerMillion + a.outputUsdPerMillion - (b.inputUsdPerMillion + b.outputUsdPerMillion))[0]!;
  const chosen = priced.find((model) => model.key === deps.state.whatIf) ?? cheapest;
  select.value = chosen.key;
  const result = html("div", "usage-whatif-result");
  const paint = (): void => {
    const model = priced.find((item) => item.key === select.value) ?? chosen;
    deps.state.whatIf = model.key;
    const estimate = whatIfCostMicros({ inputTokens: page.totals.inputTokens, outputTokens: page.totals.outputTokens }, model);
    const actual = page.totals.costMicros;
    const compare = actual === null || actual === 0 || estimate === 0 ? null : estimate / actual;
    const verdict = compare === null ? ""
      : compare >= 1.1 ? `About ${compare >= 10 ? Math.round(compare).toString() : compare.toFixed(1)} times what you spent.`
      : compare <= 0.9 ? `About ${Math.round((1 - compare) * 100).toString()}% less than you spent.` : "About the same as you spent.";
    result.replaceChildren(html("strong", "usage-whatif-value", `up to ${formatUsageCost(estimate)}`), html("span", "usage-whatif-verdict", `${verdict} You spent ${formatUsageCost(actual)}.`.trim()));
  };
  select.addEventListener("change", paint);
  paint();
  const body = html("div", "usage-whatif");
  body.append(select, result, html("p", "usage-panel-note", "Cached input is counted at that model's full input price, because its cache price is not known here, so this is the most it would cost."));
  return section("Compare your models", note, body);
}

/** Plain sentences at the top: the page in a few lines. */
function summaryPanel(page: UsagePageView, deps: UsagePageDeps): HTMLElement | null {
  const lines = usageSummary(page, deps.metric, deps.nameOf);
  if (lines.length === 0) return null;
  const box = html("section", "usage-summary");
  box.setAttribute("aria-label", "In short");
  const list = html("ul", "usage-summary-list");
  for (const line of lines) list.append(html("li", "", line));
  box.append(html("h3", "usage-summary-title", "In short"), list);
  return box;
}

export type UsageSection = "overview" | "models" | "when" | "details";

export const USAGE_SECTIONS: readonly { readonly value: UsageSection; readonly label: string; readonly note: string }[] = [
  { value: "overview", label: "Overview", note: "The total, who it went to, and how it moved day by day." },
  { value: "models", label: "Your models", note: "Each model you used: what it cost, how much it read from cache, and how fast it was." },
  { value: "when", label: "When and where", note: "Your busiest hours, the chats that cost the most, and the past year." },
  { value: "details", label: "Details", note: "Every token counted four ways, the split by type, and a table by model or day." },
];

/**
 * The Cost or Tokens view as four tabs, most useful first. Every tab is built, and the ones
 * not chosen are hidden, so switching is instant and a live refresh keeps your place.
 */
export function usagePageTabs(page: UsagePageView, deps: UsagePageDeps, activity: HTMLElement): HTMLElement {
  const root = html("div", "usage-sections");
  const nav = html("div", "ad-tabs usage-sections-nav");
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Sections");
  const note = html("p", "usage-sections-note");

  const top = html("div", "usage-top");
  top.append(hero(page, deps), chartPanel(page, deps));
  linkHighlight(top);
  const breakdown = breakdownPanel(page, deps);
  const summary = summaryPanel(page, deps);
  const pair = html("div", "usage-pair");
  pair.append(hoursPanel(page), chatsPanel(page, deps));
  const content: Record<UsageSection, HTMLElement[]> = {
    overview: [...(summary === null ? [] : [summary]), top, factsPanel(page)],
    models: [modelsPanel(page, deps), whatIfPanel(page, deps)],
    when: [pair, activity],
    details: [totalsPanel(page), typePanel(page, deps), breakdown],
  };
  const panels = new Map<UsageSection, HTMLElement>();
  const tabs = USAGE_SECTIONS.map((option) => {
    const panel = html("div", "usage-section");
    panel.id = `usage-section-${option.value}`;
    panel.setAttribute("role", "tabpanel");
    panel.append(...content[option.value]);
    stagger(panel.children);
    for (const grid of panel.querySelectorAll(".usage-tiles")) stagger(grid.children);
    panels.set(option.value, panel);
    const tab = html("button", "ad-tab usage-section-tab", option.label);
    tab.type = "button";
    tab.id = `usage-section-tab-${option.value}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("aria-labelledby", tab.id);
    tab.dataset["section"] = option.value;
    tab.addEventListener("click", () => choose(option.value, true));
    return tab;
  });
  nav.append(...tabs);
  const slide = segmentIndicator(nav, "[aria-selected=\"true\"]");
  nav.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const at = USAGE_SECTIONS.findIndex((option) => option.value === deps.state.section);
    const next = USAGE_SECTIONS[event.key === "Home" ? 0 : event.key === "End" ? USAGE_SECTIONS.length - 1 : (at + (event.key === "ArrowRight" ? 1 : USAGE_SECTIONS.length - 1)) % USAGE_SECTIONS.length]!;
    choose(next.value, true);
    tabs.find((tab) => tab.dataset["section"] === next.value)?.focus();
  });
  function choose(next: UsageSection, switched: boolean): void {
    deps.state.section = next;
    for (const tab of tabs) {
      const on = tab.dataset["section"] === next;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const [value, panel] of panels) {
      panel.hidden = value !== next;
      if (switched && value === next) panel.dataset["enter"] = "true"; else delete panel.dataset["enter"];
    }
    note.textContent = USAGE_SECTIONS.find((option) => option.value === next)!.note;
    slide();
  }
  choose(deps.state.section, false);
  root.append(nav, note, ...panels.values());
  if (deps.enter) {
    // Once, on arrival: the totals count up to their real figures.
    for (const value of root.querySelectorAll<HTMLElement>(".usage-hero-value, .usage-tile-value")) countUp(value);
  }
  return root;
}
