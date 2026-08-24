"use client";

import { useId, useMemo, useState } from "react";
import { NEUTRAL } from "./palette";

/**
 * A line-and-area chart over days, with a crosshair.
 *
 * Hand-drawn SVG rather than a charting library, for the reason the rest of this repo
 * avoids dependencies: the whole thing is ninety lines of arithmetic, and a library would
 * cost more bundle than the page it sits on. It also keeps the mark specs honest - 2px
 * lines, a 10% wash for the fill, 8px end markers with a 2px surface ring, hairline
 * gridlines a step off the surface.
 *
 * One y-axis, always. Two measures of different magnitude - views and dollars, say - get
 * two charts rather than two scales, because a dual axis lets the author choose which
 * line looks like it is winning.
 */
export interface Series {
  label: string;
  color: string;
  /** One value per point in `days`, same order. Gaps are zero, not holes. */
  values: number[];
  /** How a value reads in the tooltip and at the axis. */
  format?: (value: number) => string;
}

export interface TimeChartProps {
  /** 'YYYY-MM-DD', oldest first. */
  days: string[];
  series: Series[];
  height?: number;
  /** Filled under the first series. Off when two lines would muddy each other. */
  area?: boolean;
  /** Announced to screen readers in place of the picture. */
  summary: string;
}

const PAD = { top: 14, right: 16, bottom: 26, left: 46 };
const VIEW_W = 720;

const defaultFormat = (value: number): string => value.toLocaleString("en-US");

/** Clean axis maxima: 1, 2, 5 x a power of ten, so ticks land on numbers people read. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

const shortDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function TimeChart({ days, series, height = 240, area = false, summary }: TimeChartProps) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const max = useMemo(() => {
    const highest = Math.max(0, ...series.flatMap((s) => s.values));
    return niceMax(highest);
  }, [series]);

  // A single day would otherwise divide by zero and collapse to the left edge; it is
  // drawn in the middle instead, which is what one point actually means.
  const x = (index: number): number =>
    days.length <= 1 ? PAD.left + innerW / 2 : PAD.left + (index / (days.length - 1)) * innerW;
  const y = (value: number): number => PAD.top + innerH - (value / max) * innerH;

  const line = (values: number[]): string =>
    values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(value)}`).join(" ");

  const fill = (values: number[]): string =>
    `${line(values)} L${x(values.length - 1)} ${PAD.top + innerH} L${x(0)} ${PAD.top + innerH} Z`;

  const ticks = [0, 0.5, 1].map((fraction) => ({
    value: max * fraction,
    y: PAD.top + innerH - fraction * innerH,
  }));

  if (days.length === 0) {
    return (
      <div className="chart-empty" role="img" aria-label={summary}>
        Nothing to chart yet.
      </div>
    );
  }

  const active = hover === null ? null : Math.max(0, Math.min(hover, days.length - 1));

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = ((event.clientX - box.left) / box.width) * VIEW_W;
          const step = days.length <= 1 ? innerW : innerW / (days.length - 1);
          setHover(Math.round((ratio - PAD.left) / step));
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={PAD.left}
              x2={VIEW_W - PAD.right}
              y1={tick.y}
              y2={tick.y}
              className="chart-grid"
            />
            <text x={PAD.left - 8} y={tick.y + 4} className="chart-tick" textAnchor="end">
              {(series[0]?.format ?? defaultFormat)(Math.round(tick.value))}
            </text>
          </g>
        ))}

        {area && series[0] !== undefined && (
          <path
            d={fill(series[0].values)}
            fill={series[0].color}
            opacity={0.1}
            clipPath={`url(#${clipId})`}
          />
        )}

        {series.map((entry) => (
          <path
            key={entry.label}
            d={line(entry.values)}
            fill="none"
            stroke={entry.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        ))}

        {/* The end marker: 8px across, with a 2px ring in the surface colour so it stays
            legible where two series cross. */}
        {series.map((entry) => {
          const last = entry.values.length - 1;
          if (last < 0) return null;
          return (
            <circle
              key={`${entry.label}-end`}
              cx={x(last)}
              cy={y(entry.values[last] ?? 0)}
              r={4}
              fill={entry.color}
              className="chart-marker"
            />
          );
        })}

        {active !== null && (
          <g>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="chart-crosshair"
            />
            {series.map((entry) => (
              <circle
                key={`${entry.label}-hover`}
                cx={x(active)}
                cy={y(entry.values[active] ?? 0)}
                r={4.5}
                fill={entry.color}
                className="chart-marker"
              />
            ))}
          </g>
        )}

        <text x={PAD.left} y={height - 8} className="chart-tick" textAnchor="start">
          {shortDay(days[0] as string)}
        </text>
        {days.length > 1 && (
          <text x={VIEW_W - PAD.right} y={height - 8} className="chart-tick" textAnchor="end">
            {shortDay(days[days.length - 1] as string)}
          </text>
        )}
      </svg>

      {active !== null && (
        <div
          className="chart-tip"
          style={{
            // Kept inside the box at both ends: a tooltip that hangs off the right edge
            // of a phone is a tooltip nobody can read.
            left: `${Math.min(92, Math.max(8, (x(active) / VIEW_W) * 100))}%`,
          }}
        >
          <span className="chart-tip-day">{shortDay(days[active] as string)}</span>
          {series.map((entry) => (
            <span className="chart-tip-row" key={entry.label}>
              <i style={{ background: entry.color }} aria-hidden="true" />
              {entry.label}
              <b>{(entry.format ?? defaultFormat)(entry.values[active] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}

      {/* Two or more series always carry a legend: identity is never colour alone. */}
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((entry) => (
            <span key={entry.label}>
              <i style={{ background: entry.color }} aria-hidden="true" />
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A 12-point line for a stat tile. No axes, no hover - it is a shape, not a chart. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;

  const max = Math.max(1, ...values);
  const path = values
    .map((value, index) => {
      const px = (index / (values.length - 1)) * 100;
      const py = 24 - (value / max) * 22;
      return `${index === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 26" className="sparkline" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={NEUTRAL} strokeWidth={2} strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        // The current stretch in the accent, the rest recessive: the tile is about now.
        strokeDasharray="18 200"
        strokeDashoffset={-82}
      />
    </svg>
  );
}
