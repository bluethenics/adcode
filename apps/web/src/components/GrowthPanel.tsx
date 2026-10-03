"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { apiFetch } from "@/lib/api";
import { buildPost, DEFAULT_SHARE, dollars, parseGrowth, SHARE_METRICS, shareLine, xIntentUrl, type Growth, type ShareMetric } from "@/lib/growth";
import { SITE } from "@/lib/site";

/**
 * How many people use ADCode and how many ads it showed - and a way to post it.
 *
 * The tiles are the numbers; the share card turns the ones Sinan picks into an image and a
 * prefilled post. Nothing is sent anywhere from here: the image downloads, and the post
 * opens in X's own compose window to be read and sent by hand.
 */
export function GrowthPanel() {
  const { token } = useAuth();
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");
    void (async () => {
      try {
        const result = await apiFetch<unknown>({ path: "/admin/growth", token: await token() });
        const parsed = result.ok ? parseGrowth(result.value) : null;
        if (!active) return;
        setGrowth(parsed);
        setState(parsed === null ? "error" : "ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => { active = false; };
  }, [refresh, token]);

  return (
    <section className="growth-panel" aria-labelledby="growth-heading">
      <header className="growth-head">
        <div>
          <h2 id="growth-heading">Growth</h2>
          <p className="website-analytics-note">People using the editor and the ads it showed. Counted from accounts, ad requests and billed views, not from website visits.</p>
        </div>
        <button type="button" className="btn btn-small" disabled={state === "loading"} onClick={() => setRefresh((n) => n + 1)}>Refresh</button>
      </header>
      {state === "loading" && growth === null && <p role="status">Counting…</p>}
      {state === "error" && <p role="alert">Growth numbers could not be loaded. Refresh to retry; if it keeps failing, check that the growth_stats migration has been applied.</p>}
      {growth !== null && <GrowthReport growth={growth} />}
    </section>
  );
}

function GrowthReport({ growth }: { growth: Growth }) {
  const tiles: [string, string, string][] = [
    [growth.developers.toLocaleString(), "Developers", `+${growth.joined7d.toLocaleString()} this week · +${growth.joined30d.toLocaleString()} in 30 days`],
    [growth.active1d.toLocaleString(), "Active today", "Opened ADCode in the last 24 hours"],
    [growth.active7d.toLocaleString(), "Active this week", "Last 7 days"],
    [growth.active30d.toLocaleString(), "Active this month", "Last 30 days"],
    [growth.adsShown.toLocaleString(), "Ads shown", `${growth.adsShown7d.toLocaleString()} this week · ${growth.clicks.toLocaleString()} clicks`],
    [dollars(growth.creditedMicros), "Paid to developers", "Credited across every billed view and click"],
  ];
  const retained = growth.developers > 0 ? Math.round((growth.active7d / growth.developers) * 100) : null;

  return (
    <>
      <div className="admin-tiles growth-tiles">
        {tiles.map(([value, label, note]) => (
          <div className="admin-tile" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></div>
        ))}
      </div>
      {retained !== null && (
        <p className="website-analytics-note">
          {retained}% of all accounts opened ADCode this week. Active means the editor fetched an ad or reported a day of work; an ad shown means a sponsored card was seen and billed, not merely fetched.
        </p>
      )}
      <section className="website-analytics-card">
        <h2>Last 30 days</h2>
        <TimeChart
          days={growth.daily.map((d) => d.day)}
          series={[
            { label: "Active developers", color: "#55c9a2", values: growth.daily.map((d) => d.active) },
            { label: "New accounts", color: "#78a9ff", values: growth.daily.map((d) => d.joined) },
            { label: "Ads shown", color: "#f3c16c", values: growth.daily.map((d) => d.adsShown) },
          ]}
          summary={`Over 30 days: ${growth.active30d} active developers, ${growth.joined30d} new accounts, ${growth.adsShown30d} ads shown.`}
        />
      </section>
      <ShareCard growth={growth} />
    </>
  );
}

const CARD_W = 1200;
const CARD_H = 675;

/** Draws the share image. Plain canvas so the PNG is exactly what the preview shows. */
function drawCard(canvas: HTMLCanvasElement, growth: Growth, metrics: readonly ShareMetric[]): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const lines = metrics.map((metric) => shareLine(growth, metric));
  const [lead, ...rest] = lines;

  context.fillStyle = "#14120b";
  context.fillRect(0, 0, CARD_W, CARD_H);
  const glow = context.createRadialGradient(980, 120, 0, 980, 120, 620);
  glow.addColorStop(0, "rgba(104, 214, 177, 0.16)");
  glow.addColorStop(1, "rgba(104, 214, 177, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, CARD_W, CARD_H);

  // The mark: the same "<$>" tile the site's counter uses.
  context.fillStyle = "#edece7";
  context.beginPath();
  context.roundRect(72, 64, 56, 56, 14);
  context.fill();
  context.fillStyle = "#14120b";
  context.font = `700 22px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("<$>", 100, 93);
  context.textAlign = "left";
  context.fillStyle = "#edece7";
  context.font = `600 30px ${font}`;
  context.fillText("ADCode", 146, 93);

  if (lead !== undefined) {
    context.textBaseline = "alphabetic";
    context.fillStyle = "#edece7";
    context.font = `600 168px ${font}`;
    context.fillText(lead.value, 66, 340);
    context.fillStyle = "#a8a69d";
    context.font = `500 40px ${font}`;
    context.fillText(lead.label, 72, 398);
  }

  const columnWidth = rest.length > 0 ? (CARD_W - 144) / Math.min(rest.length, 3) : 0;
  rest.slice(0, 3).forEach((line, index) => {
    const x = 72 + index * columnWidth;
    context.fillStyle = line.value.startsWith("+") ? "#68d6b1" : "#edece7";
    context.font = `600 64px ${font}`;
    context.fillText(line.value, x, 530);
    context.fillStyle = "#a8a69d";
    context.font = `500 26px ${font}`;
    context.fillText(line.label, x, 570);
  });

  context.fillStyle = "#96948b";
  context.font = `500 22px ${font}`;
  context.fillText("The free AI code editor that pays you to build", 72, 628);
  context.textAlign = "right";
  const asOf = new Date(growth.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  context.fillText(`${SITE.origin.replace(/^https?:\/\//, "")} · ${asOf}`, CARD_W - 72, 628);
}

function ShareCard({ growth }: { growth: Growth }) {
  const [metrics, setMetrics] = useState<ShareMetric[]>([...DEFAULT_SHARE]);
  const generated = useMemo(() => buildPost(growth, metrics), [growth, metrics]);
  const [text, setText] = useState(generated);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Picking different figures rewrites the post; editing the text by hand is kept until then.
  useEffect(() => setText(generated), [generated]);
  useEffect(() => { if (canvas.current) drawCard(canvas.current, growth, metrics); }, [growth, metrics]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const toggle = (metric: ShareMetric) =>
    setMetrics((current) => current.includes(metric)
      ? current.filter((m) => m !== metric)
      : SHARE_METRICS.filter((m) => m === metric || current.includes(m)).slice(0, 4));

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (blob === null) return;
      const link = document.createElement("a");
      const href = URL.createObjectURL(blob);
      link.href = href;
      link.download = `adcode-growth-${new Date(growth.asOf).toISOString().slice(0, 10)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }, "image/png");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="website-analytics-card growth-share" aria-labelledby="growth-share-heading">
      <h2 id="growth-share-heading">Share on X and socials</h2>
      <p className="website-analytics-note">Pick up to four figures. The first is the headline. Download the image, then post the text with it.</p>
      <fieldset className="growth-share-picks">
        <legend className="sr-only">Figures to include</legend>
        {SHARE_METRICS.map((metric) => {
          const line = shareLine(growth, metric);
          const checked = metrics.includes(metric);
          return (
            <label key={metric} data-checked={checked}>
              <input type="checkbox" checked={checked} disabled={!checked && metrics.length >= 4} onChange={() => toggle(metric)} />
              <span><strong>{line.value}</strong> {line.label}</span>
            </label>
          );
        })}
      </fieldset>
      <div className="growth-share-body">
        <canvas ref={canvas} width={CARD_W} height={CARD_H} className="growth-share-canvas" role="img" aria-label={`Share image: ${metrics.map((m) => { const l = shareLine(growth, m); return `${l.value} ${l.label}`; }).join(", ")}`} />
        <div className="growth-share-post">
          <label htmlFor="growth-post">Post text</label>
          <textarea id="growth-post" value={text} rows={9} onChange={(event) => setText(event.target.value)} />
          <small>{text.length} / 280 characters</small>
          <div className="growth-share-actions">
            <button type="button" className="btn btn-small" disabled={metrics.length === 0} onClick={download}>Download image</button>
            <button type="button" className="btn btn-small" onClick={() => void copy()} aria-live="polite">{copied ? "Copied" : "Copy text"}</button>
            <a className="btn btn-small btn-primary" href={xIntentUrl(text)} target="_blank" rel="noreferrer">Post on X</a>
          </div>
        </div>
      </div>
    </section>
  );
}
