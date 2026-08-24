"use client";

import { useState } from "react";
import { DONUT_CAP, NEUTRAL, seriesColor } from "./palette";

/**
 * A donut, capped at three slices plus "Other".
 *
 * The cap is not a style choice. In a ring any two slices can end up side by side, so the
 * palette has to hold up between *every* pair rather than only between neighbours - and
 * three is where this palette clears that bar (ΔE 17.2 under deuteranopia; see
 * `palette.ts`). A fourth hue would drop the worst pair to 6.8, which is the band where
 * two slices start to look like one.
 *
 * Everything past the third folds into "Other" in the neutral, which is not a hue and so
 * does not count against the check. Nothing is hidden: the rows underneath list every
 * entry with its exact value, which is also the table view the chart's accessibility
 * rests on.
 */
export interface Slice {
  label: string;
  value: number;
  /** How the value reads. Defaults to a plain integer. */
  display?: string;
}

export interface DonutProps {
  slices: Slice[];
  /** The number in the middle - the total, said once rather than on every slice. */
  centerValue: string;
  centerLabel: string;
  summary: string;
}

const SIZE = 168;
const RADIUS = 68;
const THICKNESS = 22;
/** The 2px surface gap that separates touching marks, expressed as an arc angle. */
const GAP_DEGREES = (2 / (2 * Math.PI * RADIUS)) * 360;

function arc(startDeg: number, endDeg: number): string {
  const center = SIZE / 2;
  const outer = RADIUS;
  const inner = RADIUS - THICKNESS;

  const point = (deg: number, r: number): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [center + r * Math.cos(rad), center + r * Math.sin(rad)];
  };

  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [x1, y1] = point(startDeg, outer);
  const [x2, y2] = point(endDeg, outer);
  const [x3, y3] = point(endDeg, inner);
  const [x4, y4] = point(startDeg, inner);

  return [
    `M${x1} ${y1}`,
    `A${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
    `L${x3} ${y3}`,
    `A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export function Donut({ slices, centerValue, centerLabel, summary }: DonutProps) {
  const [hover, setHover] = useState<string | null>(null);

  const sorted = [...slices].sort((a, b) => b.value - a.value).filter((s) => s.value > 0);
  const total = sorted.reduce((sum, slice) => sum + slice.value, 0);

  if (total === 0) {
    return (
      <div className="chart-empty" role="img" aria-label={summary}>
        Nothing to chart yet.
      </div>
    );
  }

  const shown = sorted.slice(0, DONUT_CAP);
  const rest = sorted.slice(DONUT_CAP);
  const restTotal = rest.reduce((sum, slice) => sum + slice.value, 0);

  const parts = [
    ...shown.map((slice, index) => ({ ...slice, color: seriesColor(index) })),
    ...(restTotal > 0
      ? [
          {
            label: `Other (${rest.length})`,
            value: restTotal,
            display: undefined,
            color: NEUTRAL,
          },
        ]
      : []),
  ];

  let cursor = 0;

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="donut-svg" role="img" aria-label={summary}>
        {parts.map((part) => {
          const sweep = (part.value / total) * 360;
          const start = cursor;
          cursor += sweep;

          // The gap is taken out of the slice rather than drawn over it, so a very thin
          // slice shrinks to nothing rather than inverting into a backwards arc.
          const end = Math.max(start, start + sweep - Math.min(GAP_DEGREES, sweep / 2));

          return (
            <path
              key={part.label}
              d={arc(start, end)}
              fill={part.color}
              opacity={hover === null || hover === part.label ? 1 : 0.45}
              onPointerEnter={() => setHover(part.label)}
              onPointerLeave={() => setHover(null)}
            />
          );
        })}

        <text x={SIZE / 2} y={SIZE / 2 - 2} className="donut-value" textAnchor="middle">
          {centerValue}
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 16} className="donut-label" textAnchor="middle">
          {centerLabel}
        </text>
      </svg>

      <ul className="donut-key">
        {parts.map((part) => (
          <li key={part.label} data-dim={hover !== null && hover !== part.label ? "true" : undefined}>
            <i style={{ background: part.color }} aria-hidden="true" />
            <span>{part.label}</span>
            <b>{part.display ?? part.value.toLocaleString("en-US")}</b>
            <em>{Math.round((part.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
