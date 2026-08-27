interface PricePoint {
  at: number;
  clearingCpmMicros: string;
}

interface MarketPriceChartProps {
  currentCpmMicros: string;
  floorCpmMicros: string;
  asOf: number;
  history: PricePoint[];
}

const blockDollars = (cpmMicros: string): number => Number(BigInt(cpmMicros)) / 2_000_000;
const money = (value: number): string => `$${value.toFixed(2)}`;

export function MarketPriceChart({
  currentCpmMicros,
  floorCpmMicros,
  asOf,
  history,
}: MarketPriceChartProps) {
  const current = blockDollars(currentCpmMicros);
  const floor = blockDollars(floorCpmMicros);
  const source = history.map((point) => ({ at: point.at, value: blockDollars(point.clearingCpmMicros) }));
  const last = source.at(-1);
  const points = last?.at === asOf ? source : [...source, { at: asOf, value: current }];
  const values = points.map((point) => point.value);
  const min = Math.min(floor, ...values);
  const max = Math.max(floor + 0.1, ...values);
  const range = max - min || 1;
  const width = 640;
  const height = 220;
  const padX = 22;
  const padY = 24;
  const startAt = Math.min(asOf - 86_400_000, points[0]?.at ?? asOf - 86_400_000);
  const timeRange = Math.max(1, asOf - startAt);
  const x = (at: number) => padX + ((at - startAt) / timeRange) * (width - padX * 2);
  const y = (value: number) => height - padY - ((value - min) / range) * (height - padY * 2);
  const polyline = points.map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const floorY = y(floor);
  const summary = `${points.length} market price point${points.length === 1 ? "" : "s"}. Current price ${money(current)} per 500 impressions; floor ${money(floor)}.`;

  return (
    <div className="market-chart">
      <div className="market-chart-heading">
        <div>
          <span className="market-kicker"><i aria-hidden="true" /> Live auction</span>
          <h2>Current price</h2>
        </div>
        <div className="market-current" aria-live="polite">
          <strong>{money(current)}</strong>
          <span>USD / 500 impressions</span>
        </div>
      </div>

      <svg
        className="market-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
      >
        <line className="market-grid-line" x1={padX} x2={width - padX} y1={floorY} y2={floorY} />
        <text className="market-floor-label" x={padX + 4} y={Math.max(14, floorY - 7)}>
          {money(floor)} floor
        </text>
        {points.length > 1 && (
          <>
            <polygon
              className="market-area"
              points={`${polyline} ${x(points.at(-1)?.at ?? asOf).toFixed(1)},${height - padY} ${x(points[0]?.at ?? startAt).toFixed(1)},${height - padY}`}
            />
            <polyline className="market-line" points={polyline} />
          </>
        )}
        <circle className="market-point-halo" cx={x(asOf)} cy={y(current)} r="9" />
        <circle className="market-point" cx={x(asOf)} cy={y(current)} r="4" />
      </svg>

      <div className="market-chart-axis" aria-hidden="true"><span>24 hours ago</span><span>Now</span></div>
      <p className="sr-only">{summary}</p>
      {history.length === 0 && <p className="market-empty">No settled auction history yet — showing the live floor.</p>}
    </div>
  );
}
