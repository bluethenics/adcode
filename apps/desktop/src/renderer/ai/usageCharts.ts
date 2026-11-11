/**
 * The Usage dialog's charts, drawn as SVG by hand.
 *
 * Five views of the same rows, each answering one question:
 *   - the trend area: how use moved day by day, input and output stacked, with a readout
 *     that follows the pointer or the arrow keys;
 *   - the model ring: who the tokens went to;
 *   - the weekday bars: when the work happens;
 *   - the split bar: the chat against the agents;
 *   - the efficiency table: what a request costs on each model.
 *
 * No chart library: a few hundred paths do not need one, and every colour here is a token
 * so the charts follow the theme. Each chart is a labelled image with its figures also in
 * text, so nothing is only readable by eye. Motion is one draw-in on arrival, gated in CSS.
 */
import { formatTokens, formatUsageCost, type UsageModelView } from "../../shared/aiUsage.ts";
import { formatDuration, trendText, usagePayer, type UsageDayDetail, type UsageInsights, type UsagePayer, type UsagePayerTotal } from "../../shared/usageInsights.ts";

const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1).toLocaleDateString([], { month: "short", day: "numeric" });
}

function panel(title: string, note: string, ...content: (HTMLElement | SVGElement)[]): HTMLElement {
  const box = html("section", "usage-chart");
  const head = html("header", "usage-chart-head");
  head.append(html("h3", "usage-chart-title", title), html("p", "usage-chart-note", note));
  box.append(head, ...content);
  return box;
}

/** Points for a smooth-enough area: straight segments, which stay honest about daily totals. */
export function areaPath(values: readonly number[], width: number, height: number, max: number, base: readonly number[] = []): string {
  if (values.length === 0) return "";
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const y = (value: number): number => height - (max <= 0 ? 0 : (value / max) * height);
  const top = values.map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)} ${y(value + (base[index] ?? 0)).toFixed(1)}`).join(" ");
  const bottom = values.map((_value, index) => `L${((values.length - 1 - index) * step).toFixed(1)} ${y(base[values.length - 1 - index] ?? 0).toFixed(1)}`).join(" ");
  return `${top} ${bottom} Z`;
}

function trendChart(days: readonly UsageDayDetail[]): HTMLElement {
  const width = 640;
  const height = 160;
  const input = days.map((day) => day.inputTokens);
  const output = days.map((day) => day.outputTokens);
  const max = Math.max(1, ...days.map((day) => day.inputTokens + day.outputTokens));
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", class: "usage-trend", role: "img", "aria-label": `Tokens per day from ${shortDay(days[0]!.day)} to ${shortDay(days[days.length - 1]!.day)}: input and output stacked` });
  for (const fraction of [0.25, 0.5, 0.75]) chart.append(svg("line", { x1: 0, x2: width, y1: height * fraction, y2: height * fraction, class: "usage-trend-grid" }));
  chart.append(
    svg("path", { d: areaPath(input, width, height, max), class: "usage-trend-input" }),
    svg("path", { d: areaPath(output, width, height, max, input), class: "usage-trend-output" }),
  );
  const cursor = svg("line", { x1: 0, x2: 0, y1: 0, y2: height, class: "usage-trend-cursor" });
  cursor.style.opacity = "0";
  chart.append(cursor);

  const readout = html("p", "usage-trend-readout");
  readout.setAttribute("aria-live", "polite");
  const wrap = html("div", "usage-trend-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Daily tokens. Use the left and right arrow keys to read each day.");
  wrap.append(chart);
  let at = days.length - 1;
  const show = (index: number, visible: boolean): void => {
    at = Math.max(0, Math.min(days.length - 1, index));
    const day = days[at]!;
    const x = days.length === 1 ? 0 : (at / (days.length - 1)) * width;
    cursor.setAttribute("x1", x.toFixed(1));
    cursor.setAttribute("x2", x.toFixed(1));
    cursor.style.opacity = visible ? "1" : "0";
    readout.textContent = `${shortDay(day.day)} · ${formatTokens(day.inputTokens)} in · ${formatTokens(day.outputTokens)} out · ${day.requests.toLocaleString()} ${day.requests === 1 ? "request" : "requests"}${day.costMicros > 0 ? ` · ${formatUsageCost(day.costMicros)}` : ""}`;
  };
  wrap.addEventListener("pointermove", (event) => {
    const box = chart.getBoundingClientRect();
    show(Math.round(((event.clientX - box.left) / Math.max(1, box.width)) * (days.length - 1)), true);
  });
  wrap.addEventListener("pointerleave", () => show(at, false));
  wrap.addEventListener("keydown", (event) => {
    const move = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "Home" ? -days.length : event.key === "End" ? days.length : 0;
    if (move === 0) return;
    event.preventDefault();
    show(at + move, true);
  });
  wrap.addEventListener("blur", () => show(at, false));
  show(at, false);

  const legend = html("div", "usage-legend");
  legend.append(key("usage-key-input", "Input"), key("usage-key-output", "Output"));
  const axis = html("div", "usage-trend-axis");
  axis.append(html("span", "", shortDay(days[0]!.day)), html("span", "", `peak ${formatTokens(max)}`), html("span", "", shortDay(days[days.length - 1]!.day)));
  return panel("Tokens over time", "What the model read and wrote each day", wrap, axis, readout, legend);
}

function key(className: string, label: string): HTMLElement {
  const item = html("span", "usage-key");
  item.append(html("i", className), document.createTextNode(label));
  return item;
}

/** Up to five models and "Others", as arcs of one ring. Returns each slice's start and length in turns. */
export function ringSlices(models: readonly UsageModelView[], limit = 5): { readonly label: string; readonly share: number; readonly start: number }[] {
  const top = models.slice(0, limit).map((model) => ({ label: model.model, share: model.share }));
  const rest = models.slice(limit).reduce((total, model) => total + model.share, 0);
  if (rest > 0.0005) top.push({ label: `${(models.length - limit).toString()} others`, share: rest });
  let start = 0;
  return top.filter((slice) => slice.share > 0).map((slice) => {
    const out = { ...slice, start };
    start += slice.share;
    return out;
  });
}

function modelRing(models: readonly UsageModelView[]): HTMLElement {
  const slices = ringSlices(models);
  const radius = 42;
  const around = 2 * Math.PI * radius;
  const ring = svg("svg", { viewBox: "0 0 120 120", class: "usage-ring", role: "img", "aria-label": `Tokens by model: ${slices.map((slice) => `${slice.label} ${Math.round(slice.share * 100).toString()}%`).join(", ")}` });
  ring.append(svg("circle", { cx: 60, cy: 60, r: radius, class: "usage-ring-track" }));
  slices.forEach((slice, index) => {
    // A hair's gap between slices; one slice alone is a whole, unbroken ring.
    const length = Math.max(0, slice.share * around - (slices.length > 1 ? 2 : 0));
    const arc = svg("circle", { cx: 60, cy: 60, r: radius, class: `usage-ring-slice usage-series-${(index % 6).toString()}`, "stroke-dasharray": `${length.toFixed(2)} ${(around - length).toFixed(2)}`, "stroke-dashoffset": (-slice.start * around).toFixed(2), transform: "rotate(-90 60 60)" });
    arc.style.setProperty("--slice", index.toString());
    ring.append(arc);
  });
  const centre = svg("text", { x: 60, y: 58, class: "usage-ring-value", "text-anchor": "middle" });
  centre.textContent = models.length.toString();
  const centreLabel = svg("text", { x: 60, y: 72, class: "usage-ring-label", "text-anchor": "middle" });
  centreLabel.textContent = models.length === 1 ? "model" : "models";
  ring.append(centre, centreLabel);
  const list = html("ul", "usage-ring-list");
  slices.forEach((slice, index) => {
    const row = html("li", "");
    const name = html("span", "usage-ring-name", slice.label);
    name.title = slice.label;
    row.append(html("i", `usage-series-${(index % 6).toString()}`), name, html("b", "", `${Math.max(1, Math.round(slice.share * 100)).toString()}%`));
    list.append(row);
  });
  const body = html("div", "usage-ring-body");
  body.append(ring, list);
  return panel("By model", "Share of all tokens", body);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayBars(weekdays: readonly number[]): HTMLElement {
  const most = Math.max(1, ...weekdays);
  const best = weekdays.indexOf(Math.max(...weekdays));
  const bars = html("div", "usage-weekdays");
  bars.setAttribute("role", "img");
  bars.setAttribute("aria-label", `Tokens by day of the week: ${weekdays.map((value, index) => `${WEEKDAYS[index]!} ${formatTokens(value)}`).join(", ")}`);
  weekdays.forEach((value, index) => {
    const column = html("div", "usage-weekday");
    if (index === best && value > 0) column.dataset["peak"] = "true";
    const bar = html("span", "usage-weekday-bar");
    bar.style.setProperty("--height", `${value === 0 ? 0 : Math.max(4, Math.round((value / most) * 100)).toString()}%`);
    bar.style.setProperty("--order", index.toString());
    column.title = `${WEEKDAYS[index]!}: ${formatTokens(value)} tokens`;
    column.append(bar, html("span", "usage-weekday-label", WEEKDAYS[index]!));
    bars.append(column);
  });
  return panel("When you work", most <= 1 ? "No use in this period" : `Busiest on ${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][best]!}`, bars);
}

function meter(label: string, share: number, left: string, right: string, className: string): HTMLElement {
  const box = html("div", "usage-meter");
  const head = html("div", "usage-meter-head");
  head.append(html("span", "", label), html("b", "", `${Math.round(share * 100).toString()}%`));
  const track = html("div", `usage-meter-track ${className}`);
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `${label}: ${Math.round(share * 100).toString()}%`);
  const fill = html("span", "");
  fill.style.setProperty("--share", `${Math.round(share * 100).toString()}%`);
  track.append(fill);
  const foot = html("div", "usage-meter-foot");
  foot.append(html("span", "", left), html("span", "", right));
  box.append(head, track, foot);
  return box;
}

/** One row per model: what it was sent, what it wrote, what it cost and how fast it answered. */
function modelReport(insights: UsageInsights): HTMLElement {
  const table = html("table", "usage-efficiency");
  const head = html("thead", "");
  const headRow = html("tr", "");
  for (const [label, hint] of [
    ["Model", ""], ["Requests", ""], ["Read", "Input tokens, cached included"], ["Written", "Output tokens"], ["From cache", "Share of input read from the provider's cache"],
    ["Per request", "Average tokens in one request"], ["Spent", "At list price"], ["Per request", "Average cost of one request"],
    ["Answer time", "Average, start to finish"], ["First response", "Average wait before anything arrived"], ["Speed", "Output tokens per second"],
  ] as const) {
    const cell = html("th", "", label);
    cell.scope = "col";
    if (hint !== "") cell.title = hint;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = html("tbody", "");
  for (const model of insights.efficiency.slice(0, 12)) {
    const row = html("tr", "");
    const name = html("th", "");
    name.scope = "row";
    name.title = `${model.provider} · ${model.model}`;
    const payer = usagePayer(model.provider);
    name.append(html("span", "usage-efficiency-model", model.model), html("span", "usage-efficiency-payer", payer === "included" ? "Included AI" : payer === "cli" ? "CLI subscription" : "Your key"));
    const speed = model.timedRequests === 0;
    row.append(
      name,
      html("td", "", model.requests.toLocaleString()),
      html("td", "", formatTokens(model.inputTokens)),
      html("td", "", formatTokens(model.outputTokens)),
      html("td", "", `${Math.round(model.cacheShare * 100).toString()}%`),
      html("td", "", formatTokens(model.tokensPerRequest)),
      html("td", "", model.costMicros === null ? "no price" : formatUsageCost(model.costMicros)),
      html("td", "", model.costPerRequestMicros === null ? "—" : formatUsageCost(model.costPerRequestMicros)),
      html("td", "", speed ? "—" : formatDuration(model.averageResponseMs)),
      html("td", "", speed ? "—" : formatDuration(model.averageFirstResponseMs)),
      html("td", "", speed || model.tokensPerSecond === null ? "—" : `${model.tokensPerSecond.toLocaleString()} tok/s`),
    );
    body.append(row);
  }
  table.append(head, body);
  const scroll = html("div", "usage-efficiency-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Report by model. Scroll sideways for more columns.");
  scroll.append(table);
  const timed = insights.speed.timedRequests;
  return panel("Report by model", timed === 0
    ? "Speed is measured from ADCode 2.6 on, so it fills in as you use each model"
    : `Speed from ${timed.toLocaleString()} timed ${timed === 1 ? "request" : "requests"}; a long conversation costs more per request, because each one re-reads the history`, scroll);
}

const PAYER_TEXT: Readonly<Record<UsagePayer, readonly [string, string]>> = {
  included: ["Included with ADCode", "Paid for by your plan or the free allowance"],
  cli: ["On your CLI subscriptions", "Claude Code, Codex and the like, billed by them"],
  own: ["On your own keys", "Billed to you by each provider"],
};

/** Who paid for the period's use, and what it would have cost at list price. */
function payerCards(payers: readonly UsagePayerTotal[]): HTMLElement {
  const grid = html("div", "usage-payers");
  for (const total of payers) {
    const [title, note] = PAYER_TEXT[total.payer];
    const card = html("div", "usage-payer");
    card.dataset["payer"] = total.payer;
    if (total.requests === 0) card.dataset["empty"] = "true";
    const value = total.requests === 0 ? "—"
      : total.costMicros === null ? formatTokens(total.tokens)
      : formatUsageCost(total.costMicros);
    const detail = total.requests === 0 ? "Not used in this period"
      : total.costMicros === null ? `tokens · ${total.requests.toLocaleString()} requests · no list price`
      : total.payer === "included" ? `of AI at list price · ${formatTokens(total.tokens)} tokens · ${total.requests.toLocaleString()} requests`
      : `estimated · ${formatTokens(total.tokens)} tokens · ${total.requests.toLocaleString()} requests`;
    card.append(html("span", "usage-payer-title", title), html("strong", "usage-payer-value", value), html("span", "usage-payer-detail", detail), html("span", "usage-payer-note", note));
    grid.append(card);
  }
  return panel("What you got, and who paid", "The same use, split by whose account it ran on. Included AI is shown at what the same tokens cost at list price.", grid);
}

function fact(label: string, value: string, detail: string, tone = ""): HTMLElement {
  const tile = html("div", "usage-fact");
  if (tone !== "") tile.dataset["tone"] = tone;
  tile.append(html("span", "usage-fact-label", label), html("strong", "usage-fact-value", value), html("span", "usage-fact-detail", detail));
  return tile;
}

/** Everything the analysis shows, for the dialog to place under its totals. */
export function usageAnalysis(insights: UsageInsights, models: readonly UsageModelView[], enter = false): HTMLElement {
  const root = html("div", "usage-analysis");
  // Drawn in once, when the dialog opens or the range changes - not on every live update.
  if (enter) root.dataset["enter"] = "true";
  const trend = insights.trend;
  const tokensTrend = trendText(trend?.tokens);
  const facts = html("div", "usage-facts");
  facts.append(
    fact("Against the period before", tokensTrend === "" ? "—" : tokensTrend, tokensTrend === "" ? "Nothing earlier to compare with" : `tokens · requests ${trendText(trend?.requests) || "—"}`, trend?.tokens == null ? "" : trend.tokens > 0 ? "up" : trend.tokens < 0 ? "down" : ""),
    fact("Per request", formatTokens(insights.tokensPerRequest), `${insights.requestsPerActiveDay.toLocaleString()} requests on a day you used it`),
    fact("Busiest day", insights.busiest === null ? "—" : shortDay(insights.busiest.day), insights.busiest === null ? "No use yet" : `${formatTokens(insights.busiest.inputTokens + insights.busiest.outputTokens)} tokens · ${insights.busiest.requests.toLocaleString()} requests`),
    fact("Answer time", insights.speed.averageResponseMs === null ? "—" : formatDuration(insights.speed.averageResponseMs), insights.speed.tokensPerSecond === null ? "Measured from 2.6 on" : `${insights.speed.tokensPerSecond.toLocaleString()} tokens a second · first response in ${formatDuration(insights.speed.averageFirstResponseMs)}`),
    fact("Streak", `${insights.streak.toLocaleString()} ${insights.streak === 1 ? "day" : "days"}`, `${insights.activeDays.toLocaleString()} active ${insights.activeDays === 1 ? "day" : "days"} in this period`),
  );
  root.append(facts);

  const grid = html("div", "usage-chart-grid");
  if (insights.days.length > 1) grid.append(trendChart(insights.days));
  if (models.length > 0) grid.append(modelRing(models));
  grid.append(weekdayBars(insights.weekdays));
  const meters = html("div", "usage-meters");
  meters.append(
    meter("Input read from cache", insights.cacheShare, insights.cacheSavedMicros === null ? "Cached input is billed at a fraction" : `Saved about ${formatUsageCost(insights.cacheSavedMicros)}`, "of all input", "usage-meter-cache"),
    meter("Requests from agents", insights.agentShare, "Chat", "Agents", "usage-meter-agents"),
    meter("Tokens the model wrote", insights.outputShare, "Read", "Written", "usage-meter-output"),
  );
  grid.append(panel("Where it goes", "Three ways to split the same use", meters));
  root.append(grid);
  root.append(payerCards(insights.payers));
  if (insights.efficiency.length > 0) root.append(modelReport(insights));
  return root;
}
