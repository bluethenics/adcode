import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Donut } from "../src/components/charts/Donut";
import { StackedBars } from "../src/components/charts/StackedBars";
import { TimeChart } from "../src/components/charts/TimeChart";
import { Segmented } from "../src/components/ios/Segmented";
import { DONUT_CAP, MONEY, NEUTRAL, SERIES, seriesColor } from "../src/components/charts/palette";

const DAYS = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

const render = (node: React.ReactElement): string => renderToStaticMarkup(node);

/** Every `d` attribute of a `<path>` in the markup, so geometry can be inspected. */
function paths(markup: string): string[] {
  return [...markup.matchAll(/ d="([^"]+)"/g)].map((match) => match[1] as string);
}

describe("palette", () => {
  it("keeps every chart mark inside the monochrome visual system", () => {
    expect(SERIES).toEqual(["#f5f5f5", "#d4d4d4", "#b3b3b3", "#929292", "#737373", "#555555", "#404040"]);
    expect(SERIES.every((color) => /^#([0-9a-f]{2})\1\1$/i.test(color))).toBe(true);
  });

  it("renders money in white without sharing its slot with a category", () => {
    expect(SERIES).not.toContain(MONEY);
    expect(MONEY).toBe("#ffffff");
  });

  it("gives an eighth series grey rather than starting the order again", () => {
    expect(seriesColor(0)).toBe(SERIES[0]);
    expect(seriesColor(6)).toBe(SERIES[6]);
    expect(seriesColor(7)).toBe(NEUTRAL);
    expect(seriesColor(99)).toBe(NEUTRAL);
  });
});

describe("TimeChart", () => {
  const views = { label: "Views", color: seriesColor(0), values: [4, 9, 2, 12] };
  const clicks = { label: "Clicks", color: seriesColor(1), values: [1, 2, 0, 3] };

  it("draws one line per series", () => {
    const markup = render(<TimeChart days={DAYS} series={[views, clicks]} summary="s" />);
    const lines = paths(markup).filter((d) => d.startsWith("M") && !d.includes("Z"));
    expect(lines).toHaveLength(2);
  });

  it("puts a marker at the end of each line", () => {
    const markup = render(<TimeChart days={DAYS} series={[views, clicks]} summary="s" />);
    expect((markup.match(/class="chart-marker"/g) ?? []).length).toBe(2);
  });

  it("carries a legend for two series and none for one", () => {
    // Identity is never colour alone. One series needs no legend box - the title names it.
    expect(render(<TimeChart days={DAYS} series={[views, clicks]} summary="s" />)).toContain(
      "chart-legend",
    );
    expect(render(<TimeChart days={DAYS} series={[views]} summary="s" />)).not.toContain(
      "chart-legend",
    );
  });

  it("closes the area path back to the baseline when filled", () => {
    const markup = render(<TimeChart days={DAYS} area series={[views]} summary="s" />);
    expect(paths(markup).some((d) => d.endsWith("Z"))).toBe(true);
  });

  it("rounds the axis to a number people read", () => {
    // The highest value is 12, so the top tick is 20 rather than 12 - ticks that land on
    // the data's maximum make every chart's axis a different, unreadable scale.
    const markup = render(<TimeChart days={DAYS} series={[views]} summary="s" />);
    expect(markup).toContain(">20<");
  });

  it("draws a single day in the middle instead of dividing by zero", () => {
    const markup = render(
      <TimeChart days={["2026-08-23"]} series={[{ ...views, values: [5] }]} summary="s" />,
    );
    expect(markup).not.toContain("NaN");
  });

  it("survives a series that is all zeroes", () => {
    const markup = render(
      <TimeChart days={DAYS} series={[{ ...views, values: [0, 0, 0, 0] }]} summary="s" />,
    );
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("says so rather than drawing an empty box when there is no calendar", () => {
    const markup = render(<TimeChart days={[]} series={[views]} summary="Nothing yet" />);
    expect(markup).toContain("Nothing to chart yet");
    expect(markup).toContain("Nothing yet");
  });
});

describe("Donut", () => {
  const slices = [
    { label: "Alpha", value: 40 },
    { label: "Beta", value: 30 },
    { label: "Gamma", value: 20 },
    { label: "Delta", value: 6 },
    { label: "Epsilon", value: 4 },
  ];

  it("folds everything past the third slice into Other", () => {
    // In a ring any two slices can end up side by side, so the palette has to hold up
    // between every pair, not only neighbours. Three is where this one clears that bar.
    const markup = render(<Donut slices={slices} centerValue="100" centerLabel="total" summary="s" />);
    expect(markup).toContain("Other (2)");
    expect(paths(markup)).toHaveLength(DONUT_CAP + 1);
  });

  it("paints Other in the neutral, which is not a categorical hue", () => {
    const markup = render(<Donut slices={slices} centerValue="100" centerLabel="total" summary="s" />);
    expect(markup).toContain(`fill="${NEUTRAL}"`);
  });

  it("draws no Other when everything fits", () => {
    const markup = render(
      <Donut slices={slices.slice(0, 3)} centerValue="90" centerLabel="total" summary="s" />,
    );
    expect(markup).not.toContain("Other");
    expect(paths(markup)).toHaveLength(3);
  });

  it("lists every entry with its own value, folded or not", () => {
    // The key is also the table view the chart's accessibility rests on: nothing is
    // hidden by the cap, only recoloured.
    const markup = render(<Donut slices={slices} centerValue="100" centerLabel="total" summary="s" />);
    for (const label of ["Alpha", "Beta", "Gamma"]) expect(markup).toContain(label);
    expect(markup).toContain("40%");
  });

  it("orders slices by size rather than by the order they arrived", () => {
    const shuffled = [
      { label: "Small", value: 1 },
      { label: "Big", value: 99 },
    ];
    const markup = render(<Donut slices={shuffled} centerValue="100" centerLabel="total" summary="s" />);
    expect(markup.indexOf("Big")).toBeLessThan(markup.indexOf("Small"));
  });

  it("drops slices worth nothing instead of drawing zero-width arcs", () => {
    const markup = render(
      <Donut
        slices={[{ label: "Real", value: 10 }, { label: "Empty", value: 0 }]}
        centerValue="10"
        centerLabel="total"
        summary="s"
      />,
    );
    expect(paths(markup)).toHaveLength(1);
    expect(markup).not.toContain("Empty");
  });

  it("says so rather than dividing by zero when everything is empty", () => {
    const markup = render(
      <Donut slices={[{ label: "None", value: 0 }]} centerValue="0" centerLabel="t" summary="s" />,
    );
    expect(markup).toContain("Nothing to chart yet");
    expect(markup).not.toContain("NaN");
  });
});

describe("StackedBars", () => {
  const series = [
    { label: "You typed", color: seriesColor(0), values: [100, 0, 40, 80] },
    { label: "AI agent wrote", color: seriesColor(1), values: [50, 0, 10, 0] },
  ];

  it("rounds only the cap of each column", () => {
    // Rounding an interior segment reads as a gap in the middle of the column.
    const markup = render(<StackedBars days={DAYS} series={series} summary="s" />);
    const rounded = (markup.match(/rx="4"/g) ?? []).length;
    // Three days have data; the fourth is all zeroes and draws nothing.
    expect(rounded).toBe(3);
  });

  it("falls back to the lower segment for the cap when the top one is empty", () => {
    const markup = render(<StackedBars days={["2026-08-23"]} series={[
      { label: "You typed", color: seriesColor(0), values: [80] },
      { label: "AI agent wrote", color: seriesColor(1), values: [0] },
    ]} summary="s" />);
    expect((markup.match(/rx="4"/g) ?? []).length).toBe(1);
  });

  it("draws nothing at all for a day with no work", () => {
    const markup = render(<StackedBars days={["2026-08-23"]} series={[
      { label: "You typed", color: seriesColor(0), values: [0] },
      { label: "AI agent wrote", color: seriesColor(1), values: [0] },
    ]} summary="s" />);
    // The transparent hit target for the band survives, and so does the legend swatch -
    // it is the filled `rect` that must not exist, not the colour string.
    expect(markup).not.toContain(`fill="${seriesColor(0)}"`);
    expect(markup).toContain('fill="transparent"');
  });

  it("always carries a legend, because it always has two or more series", () => {
    const markup = render(<StackedBars days={DAYS} series={series} summary="s" />);
    expect(markup).toContain("chart-legend");
    expect(markup).toContain("You typed");
    expect(markup).toContain("AI agent wrote");
  });

  it("says so rather than drawing an empty box with no calendar", () => {
    expect(render(<StackedBars days={[]} series={series} summary="s" />)).toContain(
      "Nothing to chart yet",
    );
  });
});

describe("Segmented", () => {
  const options = [
    { value: "a" as const, label: "Overview" },
    { value: "b" as const, label: "Coding" },
    { value: "c" as const, label: "Ledger" },
  ];

  it("is a real radio group, so a screen reader announces the position", () => {
    const markup = render(
      <Segmented label="View" value="b" options={options} onChange={() => undefined} />,
    );
    expect(markup).toContain('role="radiogroup"');
    expect((markup.match(/type="radio"/g) ?? []).length).toBe(3);
  });

  it("checks exactly the selected option", () => {
    const markup = render(
      <Segmented label="View" value="b" options={options} onChange={() => undefined} />,
    );
    expect((markup.match(/checked=""/g) ?? []).length).toBe(1);
  });

  it("slides the pill to the selected index", () => {
    const markup = render(
      <Segmented label="View" value="c" options={options} onChange={() => undefined} />,
    );
    expect(markup).toContain("--index:2");
    expect(markup).toContain("--count:3");
  });

  it("falls back to the first slot rather than hiding the pill on an unknown value", () => {
    const markup = render(
      <Segmented
        label="View"
        value={"zzz" as unknown as "a"}
        options={options}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain("--index:0");
  });
});
