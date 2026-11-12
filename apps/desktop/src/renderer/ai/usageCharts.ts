/**
 * The Usage page's charts, drawn as SVG and plain HTML by hand.
 *
 *   - the provider area: each provider's daily tokens or cost, stacked and smoothed, with a
 *     tooltip that follows the pointer or the arrow keys;
 *   - the type bar: one bar split into fresh input, cache reads and output;
 *   - the hour map: requests by weekday and hour of day.
 *
 * No chart library: a few paths do not need one. Colours are series classes defined once in
 * usageCharts.css for both themes, and a series keeps its colour when a filter hides others.
 * Every chart is a labelled image whose figures are also in text nearby, so nothing is only
 * readable by eye. Motion is one draw-in on arrival, gated in CSS.
 */
import { formatTokens, formatUsageCost, type UsageModelView } from "../../shared/aiUsage.ts";
import { hourLabel, smoothLine, WEEKDAY_NAMES, type UsagePageDay } from "../../shared/usagePage.ts";

const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Six categorical slots, then everything else in one quiet grey. */
export const seriesClass = (index: number): string => (index >= 0 && index < 6 ? `usage-series-${index.toString()}` : "usage-series-other");

export function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function longDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, date ?? 1).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Points for a straight-segment area. Kept for the tests and anything that wants exact daily totals. */
export function areaPath(values: readonly number[], width: number, height: number, max: number, base: readonly number[] = []): string {
  if (values.length === 0) return "";
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const y = (value: number): number => height - (max <= 0 ? 0 : (value / max) * height);
  const top = values.map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)} ${y(value + (base[index] ?? 0)).toFixed(1)}`).join(" ");
  const bottom = values.map((_value, index) => `L${((values.length - 1 - index) * step).toFixed(1)} ${y(base[values.length - 1 - index] ?? 0).toFixed(1)}`).join(" ");
  return `${top} ${bottom} Z`;
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

/** A smoothed band between `top` and `base`, both already in chart coordinates. */
function bandPath(top: readonly (readonly [number, number])[], base: readonly (readonly [number, number])[]): string {
  const back = smoothLine([...base].reverse());
  return `${smoothLine(top)} L${back.slice(1)} Z`;
}

export interface ProviderChartInput {
  readonly days: readonly UsagePageDay[];
  /** Provider ids in the order of `days[].tokensBy`. */
  readonly series: readonly string[];
  readonly metric: "cost" | "tokens";
  readonly nameOf: (provider: string) => string;
  /** The provider's colour class, the same everywhere on the page. */
  readonly colourOf: (provider: string) => string;
}

/** Each provider's day, stacked and smoothed, with a tooltip for the day under the pointer. */
export function providerChart(input: ProviderChartInput): HTMLElement {
  const { days, series, metric } = input;
  const width = 640;
  const height = 180;
  const valuesOf = (day: UsagePageDay): readonly number[] => (metric === "cost" ? day.costBy : day.tokensBy);
  const totalOf = (day: UsagePageDay): number => valuesOf(day).reduce((sum, value) => sum + value, 0);
  const format = (value: number): string => (metric === "cost" ? formatUsageCost(value) : formatTokens(value));
  const max = Math.max(1, ...days.map(totalOf)) * 1.08;
  const x = (index: number): number => (days.length === 1 ? width / 2 : (index / (days.length - 1)) * width);
  const y = (value: number): number => height - (value / max) * height;

  const chart = svg("svg", { viewBox: `0 0 ${width.toString()} ${height.toString()}`, preserveAspectRatio: "none", class: "usage-area", role: "img",
    "aria-label": `${metric === "cost" ? "Cost" : "Tokens"} per day by provider, ${shortDay(days[0]!.day)} to ${shortDay(days[days.length - 1]!.day)}` });
  for (const fraction of [0.25, 0.5, 0.75]) chart.append(svg("line", { x1: 0, x2: width, y1: height * fraction, y2: height * fraction, class: "usage-area-grid" }));
  chart.append(svg("line", { x1: 0, x2: width, y1: height, y2: height, class: "usage-area-base" }));

  // Stack from the biggest provider at the bottom; a filter that hides one keeps the others' colours.
  let below = days.map(() => 0);
  series.forEach((provider, at) => {
    const above = days.map((day, index) => below[index]! + (valuesOf(day)[at] ?? 0));
    if (above.every((value, index) => value === below[index])) { below = above; return; }
    const top = above.map((value, index) => [x(index), y(value)] as const);
    const base = below.map((value, index) => [x(index), y(value)] as const);
    const layer = svg("g", { class: `usage-area-layer ${input.colourOf(provider)}`, "data-provider": provider });
    layer.style.setProperty("--layer", at.toString());
    layer.append(svg("path", { d: bandPath(top, base), class: "usage-area-fill" }), svg("path", { d: smoothLine(top), class: "usage-area-line" }));
    chart.append(layer);
    below = above;
  });

  const yAxis = html("div", "usage-area-y");
  yAxis.setAttribute("aria-hidden", "true");
  for (const fraction of [0.75, 0.5, 0.25]) {
    const label = html("span", "", format(Math.round(max * (1 - fraction))));
    label.style.top = `${(fraction * 100).toString()}%`;
    yAxis.append(label);
  }

  const tip = html("div", "usage-tip");
  tip.setAttribute("role", "status");
  const wrap = html("div", "usage-area-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Daily chart. Use the left and right arrow keys to read each day.");
  // The crosshair and tooltip are HTML placed with transforms, so they glide after the pointer.
  const cursor = html("span", "usage-area-cursor");
  cursor.setAttribute("aria-hidden", "true");
  wrap.append(chart, yAxis, cursor, tip);

  let at = days.length - 1;
  const show = (index: number, visible: boolean): void => {
    at = Math.max(0, Math.min(days.length - 1, index));
    const day = days[at]!;
    const left = days.length === 1 ? 50 : (at / (days.length - 1)) * 100;
    const px = (left / 100) * wrap.clientWidth;
    cursor.style.transform = `translateX(${px.toFixed(1)}px)`;
    wrap.dataset["active"] = String(visible);
    const side = left > 60 ? "left" : "right";
    tip.dataset["side"] = side;
    const head = html("div", "usage-tip-head");
    head.append(html("strong", "", longDay(day.day)), html("span", "", format(totalOf(day))));
    const list = html("ul", "usage-tip-rows");
    series.forEach((provider, index) => {
      const value = valuesOf(day)[index] ?? 0;
      if (value === 0 && series.length > 4) return;
      const item = html("li", input.colourOf(provider));
      item.append(html("i", "usage-swatch"), html("span", "usage-tip-name", input.nameOf(provider)), html("b", "", format(value)));
      list.append(item);
    });
    if (list.childElementCount === 0) list.append(html("li", "usage-tip-none", "Nothing used"));
    tip.replaceChildren(head, list);
    tip.style.setProperty("--tip-x", `${(side === "left" ? px - 10 - tip.offsetWidth : px + 10).toFixed(1)}px`);
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
  wrap.addEventListener("focus", () => show(at, true));
  wrap.addEventListener("blur", () => show(at, false));
  show(at, false);

  const axis = html("div", "usage-area-axis");
  axis.setAttribute("aria-hidden", "true");
  const middle = days[Math.floor((days.length - 1) / 2)]!;
  axis.append(html("span", "", shortDay(days[0]!.day)), html("span", "", days.length > 2 ? shortDay(middle.day) : ""), html("span", "", shortDay(days[days.length - 1]!.day)));

  const legend = html("div", "usage-legend");
  // Only providers that drew something get a key; one with nothing to draw would point at no colour.
  for (const provider of series.filter((_id, index) => days.some((day) => (valuesOf(day)[index] ?? 0) > 0))) {
    const item = html("span", `usage-key ${input.colourOf(provider)}`);
    item.dataset["provider"] = provider;
    item.append(html("i", "usage-swatch"), document.createTextNode(input.nameOf(provider)));
    legend.append(item);
  }
  const box = html("div", "usage-area-box");
  box.append(wrap, axis, legend);
  return box;
}

export interface TypePart {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  /** Shown in place of a value that is not known. */
  readonly missing?: string;
  readonly hint: string;
}

/** One bar split into parts, with a legend that says each part's size in words. */
export function typeBar(parts: readonly TypePart[], format: (value: number) => string, label: string): HTMLElement {
  const known = parts.filter((part) => part.value !== null && part.value > 0);
  const total = known.reduce((sum, part) => sum + (part.value ?? 0), 0);
  const bar = html("div", "usage-typebar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${label}: ${parts.map((part) => `${part.label} ${part.value === null ? part.missing ?? "not known" : format(part.value)}`).join(", ")}`);
  for (const part of known) {
    const segment = html("span", `usage-typebar-part usage-type-${part.key}`);
    segment.style.setProperty("--share", `${((part.value! / Math.max(1, total)) * 100).toFixed(2)}%`);
    segment.title = `${part.label}: ${format(part.value!)} (${Math.round((part.value! / Math.max(1, total)) * 100).toString()}%)`;
    bar.append(segment);
  }
  const legend = html("ul", "usage-typelegend");
  for (const part of parts) {
    const item = html("li", `usage-type-${part.key}`);
    if (part.value === null || part.value === 0) item.dataset["empty"] = "true";
    const share = part.value === null || total === 0 ? "" : `${Math.round((part.value / total) * 100).toString()}%`;
    const text = html("div", "usage-typelegend-text");
    text.append(html("span", "usage-typelegend-label", part.label), html("span", "usage-typelegend-hint", part.hint));
    const value = html("div", "usage-typelegend-value");
    value.append(html("b", "", part.value === null ? part.missing ?? "Not known" : format(part.value)), html("span", "", share));
    item.append(html("i", "usage-swatch"), text, value);
    legend.append(item);
  }
  const box = html("div", "usage-typebox");
  box.append(bar, legend);
  return box;
}

/** One day's requests per hour, as 24 thin bars. */
export function hourBars(hours: readonly number[]): HTMLElement {
  const max = Math.max(1, ...hours);
  const busiest = hours.indexOf(Math.max(...hours));
  const bars = html("div", "usage-hourbars");
  bars.setAttribute("role", "img");
  bars.setAttribute("aria-label", `Requests by hour today. Busiest: ${hourLabel(busiest)}, ${(hours[busiest] ?? 0).toLocaleString()} requests.`);
  hours.forEach((count, hour) => {
    const bar = html("span", "usage-hourbar");
    bar.style.setProperty("--height", `${count === 0 ? 0 : Math.max(4, Math.round((count / max) * 100)).toString()}%`);
    bar.title = `${hourLabel(hour)}: ${count.toLocaleString()} ${count === 1 ? "request" : "requests"}`;
    if (hour === busiest && count > 0) bar.dataset["peak"] = "true";
    bars.append(bar);
  });
  const axis = html("div", "usage-hours-axis usage-hourbars-axis");
  axis.setAttribute("aria-hidden", "true");
  for (const hour of [0, 6, 12, 18]) {
    const label = html("span", "", hourLabel(hour));
    label.style.setProperty("--hour", hour.toString());
    axis.append(label);
  }
  const box = html("div", "usage-area-box");
  box.append(bars, axis, html("p", "usage-hours-readout", `Busiest at ${hourLabel(busiest)}: ${(hours[busiest] ?? 0).toLocaleString()} ${hours[busiest] === 1 ? "request" : "requests"}`));
  return box;
}

const SHORT_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Requests by weekday and hour: a 7 by 24 grid in one hue, darker for busier. */
export function hourMap(grid: readonly (readonly number[])[]): HTMLElement {
  const max = Math.max(1, ...grid.flat());
  const box = html("div", "usage-hours");
  const map = html("div", "usage-hours-grid");
  map.tabIndex = 0;
  map.setAttribute("role", "group");
  map.setAttribute("aria-label", "Requests by day of the week and hour. Use the arrow keys to read each hour.");
  const readout = html("p", "usage-hours-readout");
  readout.setAttribute("role", "status");
  const cells: HTMLElement[][] = [];
  grid.forEach((hours, weekday) => {
    map.append(html("span", "usage-hours-day", SHORT_WEEKDAYS[weekday]!));
    cells.push(hours.map((count, hour) => {
      const cell = html("span", "usage-hours-cell");
      cell.dataset["level"] = count === 0 ? "0" : String(Math.min(4, Math.ceil((count / max) * 4)));
      cell.dataset["weekday"] = weekday.toString();
      cell.dataset["hour"] = hour.toString();
      map.append(cell);
      return cell;
    }));
  });
  const axis = html("div", "usage-hours-axis");
  axis.setAttribute("aria-hidden", "true");
  for (const hour of [0, 6, 12, 18]) {
    const label = html("span", "", hourLabel(hour));
    label.style.setProperty("--hour", hour.toString());
    axis.append(label);
  }
  let focus: [number, number] = [0, 0];
  let best = -1;
  grid.forEach((hours, weekday) => hours.forEach((count, hour) => { if (count > best) { best = count; focus = [weekday, hour]; } }));
  const say = (weekday: number, hour: number): void => {
    const count = grid[weekday]?.[hour] ?? 0;
    readout.textContent = `${WEEKDAY_NAMES[weekday]!}s, ${hourLabel(hour)} to ${hourLabel(hour + 1)}: ${count.toLocaleString()} ${count === 1 ? "request" : "requests"}`;
  };
  const mark = (weekday: number, hour: number): void => {
    for (const row of cells) for (const cell of row) delete cell.dataset["current"];
    cells[weekday]![hour]!.dataset["current"] = "true";
    focus = [weekday, hour];
    say(weekday, hour);
  };
  map.addEventListener("pointerover", (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>(".usage-hours-cell");
    if (cell !== null) say(Number(cell.dataset["weekday"]), Number(cell.dataset["hour"]));
  });
  map.addEventListener("keydown", (event) => {
    const [weekday, hour] = focus;
    const next: [number, number] | null = event.key === "ArrowLeft" ? [weekday, (hour + 23) % 24] : event.key === "ArrowRight" ? [weekday, (hour + 1) % 24]
      : event.key === "ArrowUp" ? [(weekday + 6) % 7, hour] : event.key === "ArrowDown" ? [(weekday + 1) % 7, hour] : null;
    if (next === null) return;
    event.preventDefault();
    mark(...next);
  });
  map.addEventListener("focus", () => mark(...focus));
  map.addEventListener("blur", () => { for (const row of cells) for (const cell of row) delete cell.dataset["current"]; });
  say(...focus);
  const scale = html("div", "usage-hours-scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(html("span", "", "Quiet"));
  for (const level of [0, 1, 2, 3, 4]) {
    const swatch = html("span", "usage-hours-cell");
    swatch.dataset["level"] = level.toString();
    scale.append(swatch);
  }
  scale.append(html("span", "", "Busy"));
  const scroll = html("div", "usage-hours-scroll");
  const inner = html("div", "usage-hours-inner");
  inner.append(map, axis);
  scroll.append(inner);
  box.append(scroll, readout, scale);
  return box;
}
