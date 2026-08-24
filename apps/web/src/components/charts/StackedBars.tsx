"use client";

import { useState } from "react";

/**
 * Columns split into two or more parts, one column per day.
 *
 * The specs that make it quiet: columns capped at 24px so the band keeps some air, a 4px
 * rounded cap with a square foot on the baseline, and a 2px gap in the surface colour
 * between the segments of a stack. The gap is what separates them - never a stroke, which
 * would add ink that is not data.
 *
 * Values are not printed on the segments. A number on every part of every column is
 * chaos, and an interior segment has no free end to put one on anyway; the total rides
 * the top of the column and the tooltip carries the breakdown.
 */
export interface StackSeries {
  label: string;
  color: string;
  values: number[];
}

export interface StackedBarsProps {
  days: string[];
  series: StackSeries[];
  height?: number;
  format?: (value: number) => string;
  summary: string;
}

const PAD = { top: 18, right: 8, bottom: 26, left: 8 };
const VIEW_W = 720;
const MAX_BAR = 24;
const SEGMENT_GAP = 2;

const shortDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const compact = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}K`
      : String(Math.round(value));

export function StackedBars({
  days,
  series,
  height = 200,
  format = compact,
  summary,
}: StackedBarsProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (days.length === 0) {
    return (
      <div className="chart-empty" role="img" aria-label={summary}>
        Nothing to chart yet.
      </div>
    );
  }

  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const band = innerW / days.length;
  const width = Math.min(MAX_BAR, band * 0.62);

  const totals = days.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
        onPointerLeave={() => setHover(null)}
      >
        <line
          x1={PAD.left}
          x2={VIEW_W - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          className="chart-grid"
        />

        {days.map((day, index) => {
          const cx = PAD.left + band * index + band / 2;
          let baseline = PAD.top + innerH;
          // Segments stack upward in series order, so the last one with anything in it is
          // the cap - and the only one whose corners get rounded.
          const topMost = series.reduce(
            (found, entry, at) => ((entry.values[index] ?? 0) > 0 ? at : found),
            -1,
          );

          return (
            <g
              key={day}
              onPointerEnter={() => setHover(index)}
              opacity={hover === null || hover === index ? 1 : 0.5}
            >
              {/* A hit target the width of the whole band: a 6px column is impossible to
                  hover on a laptop trackpad, let alone a phone. */}
              <rect
                x={PAD.left + band * index}
                y={PAD.top}
                width={band}
                height={innerH}
                fill="transparent"
              />

              {series.map((entry, at) => {
                const value = entry.values[index] ?? 0;
                if (value <= 0) return null;

                const raw = (value / max) * innerH;
                // The 2px gap is taken out of the segment rather than drawn over it, and
                // a segment never shrinks below a hairline - a day with one character in
                // it should still be visible.
                const barHeight = Math.max(1, raw - SEGMENT_GAP);
                const y = baseline - barHeight;
                baseline -= raw;

                return (
                  <rect
                    key={entry.label}
                    x={cx - width / 2}
                    y={y}
                    width={width}
                    height={barHeight}
                    fill={entry.color}
                    // Only the cap is rounded; rounding an interior segment would read as
                    // a gap in the middle of the column.
                    rx={at === topMost ? 4 : 0}
                  />
                );
              })}
            </g>
          );
        })}

        <text x={PAD.left} y={height - 8} className="chart-tick" textAnchor="start">
          {shortDay(days[0] as string)}
        </text>
        {days.length > 1 && (
          <text x={VIEW_W - PAD.right} y={height - 8} className="chart-tick" textAnchor="end">
            {shortDay(days[days.length - 1] as string)}
          </text>
        )}
      </svg>

      {hover !== null && days[hover] !== undefined && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(92, Math.max(8, ((PAD.left + band * hover + band / 2) / VIEW_W) * 100))}%`,
          }}
        >
          <span className="chart-tip-day">{shortDay(days[hover] as string)}</span>
          {series.map((entry) => (
            <span className="chart-tip-row" key={entry.label}>
              <i style={{ background: entry.color }} aria-hidden="true" />
              {entry.label}
              <b>{format(entry.values[hover] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="chart-legend">
        {series.map((entry) => (
          <span key={entry.label}>
            <i style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}
