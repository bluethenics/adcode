"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { apiFetch } from "@/lib/api";
import { buildPost, DEFAULT_SHARE, dollars, MILESTONE_LABELS, parseGrowth, percent, SHARE_METRICS, shareLine, xIntentUrl, type Growth, type GrowthFunnel, type ShareMetric } from "@/lib/growth";
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
    [
      growth.developers.toLocaleString(),
      "Developers",
      growth.accounts === null
        ? `+${growth.joined7d.toLocaleString()} this week · +${growth.joined30d.toLocaleString()} in 30 days`
        : `Did something at least once · ${growth.accounts.toLocaleString()} accounts in all · +${growth.joined7d.toLocaleString()} first seen in 7 days`,
    ],
    [growth.active1d.toLocaleString(), "Active, last 24 hours", "Seen in the past 24 hours - a rolling window, not the UTC day"],
    growth.returning7d === null
      ? [growth.active7d.toLocaleString(), "Active, last 7 days", "Rolling 7 days"]
      : [growth.returning7d.toLocaleString(), "Came back, last 7 days", `Of ${growth.active7d.toLocaleString()} active - seen again at least a day after first using the editor`],
    [growth.active30d.toLocaleString(), "Active, last 30 days", "Rolling 30 days"],
    [growth.adsShown.toLocaleString(), "Ads shown", `${growth.adsShown7d.toLocaleString()} in 7 days · ${growth.clicks.toLocaleString()} clicks`],
    [dollars(growth.creditedMicros), "Earned by developers", "Credited from every billed view and click - not all of it withdrawn"],
    ...(growth.paidOutMicros === null ? [] : [[dollars(growth.paidOutMicros), "Paid out", "Withdrawals actually sent to developers"] as [string, string, string]]),
  ];
  // Fields this build reads that the API did not send: the report is from an older API or
  // an unapplied migration, and its numbers follow the older rules.
  const behind = growth.accounts === null || growth.paidOutMicros === null || growth.funnel === null || growth.funnel.journey === null;
  const hasReturning = growth.daily.some((d) => d.returning !== null);

  return (
    <>
      {behind && (
        <p className="notice" data-tone="info" role="status">
          This report comes from an API that predates the current growth rules, so some figures below follow the older definitions
          (a developer measured from account creation, cohorts that shift daily, paid-out money missing). Apply migrations
          20261003120000 and 20261006180000 and deploy the API, then refresh.
        </p>
      )}
      <div className="admin-tiles growth-tiles">
        {tiles.map(([value, label, note]) => (
          <div className="admin-tile" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></div>
        ))}
      </div>
      <p className="website-analytics-note">
        A developer is an account that fetched an ad, reported editor activity or reached a first-session milestone at least once; an account that never did - most are web-only, such as advertisers - is counted only in the total. A developer joins the first time they are seen, not when the account was made, so somebody who signed up on the website and opened the editor days later is new on that day. Came back means seen again at least a day after first being seen - the number that says whether people stay. An ad shown means a sponsored card was seen and billed, not merely fetched. Earned is what developers were credited; paid out is what was withdrawn.
      </p>
      <section className="website-analytics-card">
        <h2>Last 30 days</h2>
        <TimeChart
          days={growth.daily.map((d) => d.day)}
          series={[
            { label: "Active developers", color: "#55c9a2", values: growth.daily.map((d) => d.active) },
            ...(hasReturning ? [{ label: "Came back", color: "#c58af9", values: growth.daily.map((d) => d.returning ?? 0) }] : []),
            { label: "New developers", color: "#78a9ff", values: growth.daily.map((d) => d.joined) },
            { label: "Ads shown", color: "#f3c16c", values: growth.daily.map((d) => d.adsShown) },
          ]}
          summary={`Over 30 days: ${growth.active30d} active developers, ${growth.joined30d} new developers, ${growth.adsShown30d} ads shown.`}
        />
      </section>
      {growth.cohorts.length > 0 && <CohortTable growth={growth} />}
      {growth.funnel !== null && <FunnelCard funnel={growth.funnel} />}
      <ShareCard growth={growth} />
    </>
  );
}

const DAY_MS = 86_400_000;

/** Each week's sign-ups and how many came back, with weeks too recent to judge marked as such. */
function CohortTable({ growth }: { growth: Growth }) {
  const cell = (part: number, whole: number, matureAt: number) => {
    if (growth.asOf < matureAt) return <span className="growth-cohort-early">Too early</span>;
    const share = percent(part, whole);
    return <>{part.toLocaleString()}{share === null ? "" : <small> · {share}%</small>}</>;
  };
  return (
    <section className="website-analytics-card" aria-labelledby="growth-cohorts-heading">
      <h2 id="growth-cohorts-heading">Who came back, by the week they started</h2>
      <table>
        <thead>
          <tr><th>Week of</th><th>Joined</th><th>Back after a day</th><th>Back after a week</th></tr>
        </thead>
        <tbody>
          {[...growth.cohorts].reverse().map((cohort) => {
            const end = Date.parse(`${cohort.weekStart}T00:00:00.000Z`) + 7 * DAY_MS;
            return (
              <tr key={cohort.weekStart}>
                <td>{new Date(`${cohort.weekStart}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</td>
                <td>{cohort.joined.toLocaleString()}</td>
                <td>{cell(cohort.back1d, cohort.joined, end + DAY_MS)}</td>
                <td>{cell(cohort.back7d, cohort.joined, end + 7 * DAY_MS)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="website-analytics-note">Calendar weeks, Monday to Sunday (UTC), so a week holds the same people in every report; this week is still filling. Back after a day: seen again at least 24 hours after first being seen. Back after a week: at least 7 days after. A week is marked too early until everybody in it has had that long.</p>
    </section>
  );
}

/** One row per step: the label, a bar, and the count with its share of the base. */
function FunnelSteps({ steps, base }: { steps: { name: string; accounts: number }[]; base: number }) {
  return (
    <ol className="growth-funnel">
      {steps.map((step) => {
        const share = percent(step.accounts, base) ?? 0;
        return (
          <li key={step.name}>
            <span className="growth-funnel-label">{MILESTONE_LABELS[step.name] ?? step.name}</span>
            <span className="growth-funnel-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
            <span className="growth-funnel-value">{step.accounts.toLocaleString()} <small>{share}%</small></span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How far the last 30 days' new developers got in their first day: the main path, in order,
 * then every milestone on its own. A milestone from a later day is a later session and is not
 * counted here.
 */
function FunnelCard({ funnel }: { funnel: GrowthFunnel }) {
  const counted = funnel.steps.some((step) => step.accounts > 0);
  return (
    <section className="website-analytics-card" aria-labelledby="growth-funnel-heading">
      <h2 id="growth-funnel-heading">{funnel.journey === null ? "First session, last 30 days" : "First day, last 30 days"}</h2>
      {!counted && (
        <p className="website-analytics-note">No milestones yet. They are reported by the desktop release that adds the new welcome and free AI setup; installs before it report none.</p>
      )}
      {funnel.journey !== null && (
        <>
          <h3 className="growth-funnel-heading">The main path, in order</h3>
          <FunnelSteps steps={funnel.journey} base={funnel.base} />
          <p className="website-analytics-note">Each step counts people who reached it after the step before, within 24 hours of first being seen, so the numbers can only fall.</p>
          <h3 className="growth-funnel-heading">Every milestone in the first day</h3>
        </>
      )}
      <FunnelSteps steps={funnel.steps} base={funnel.base} />
      <p className="website-analytics-note">Out of {funnel.base.toLocaleString()} developers first seen in the last 30 days. {funnel.journey === null
        ? "Each step counts people who reached it at least once."
        : "Each milestone counts people who reached it within 24 hours of first being seen, in any order; some are alternatives (finish or skip the welcome, three ways to connect AI) and some are detours (an AI error)."}</p>
    </section>
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
        {SHARE_METRICS.filter((metric) => metric !== "paidOut" || growth.paidOutMicros !== null).map((metric) => {
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
