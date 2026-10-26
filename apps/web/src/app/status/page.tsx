import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CopyField } from "@/components/CopyField";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { ALTERNATE_TYPES, pageMetadata } from "@/lib/seo";
import { SITE, url } from "@/lib/site";
import {
  IMPACT_LABELS,
  INCIDENT_STATUS_LABELS,
  LEVEL_LABELS,
  readStatus,
  type StatusDay,
  type StatusIncident,
  type StatusModel,
  type StatusView,
} from "@/lib/status";
import "./status.css";

/**
 * The public status page.
 *
 * Two sources with one voice. Model health is computed by the API from the daily outcome
 * counts every editor already reports - nothing hand-entered, so the bars cannot be
 * flattering. Incidents are hand-written, because a red bar tells a reader that something
 * is wrong and never whether anybody knows.
 *
 * Deliberately server-rendered with no client JavaScript: during the one moment the page
 * matters, a bundle that fails to hydrate must not take the answer with it. Hover, focus
 * and load animations are CSS only.
 */

/** Rendered, and re-rendered at most once a minute so an incident posted in the panel shows up. */
export const revalidate = 60;

export const metadata: Metadata = {
  ...pageMetadata({
    path: "/status",
    title: "Status",
    socialTitle: "ADCode status — included AI, live",
    description:
      "Live operational status for the AI models included with ADCode: uptime over the past 90 days, error rates, and the incident log with updates as they happen.",
  }),
  alternates: {
    canonical: url("/status"),
    types: {
      ...ALTERNATE_TYPES,
      "application/rss+xml": [
        { url: url("/status/feed.xml"), title: "ADCode status updates" },
        { url: url("/feed.xml"), title: `${SITE.name} updates` },
      ],
    },
  },
};

const STATUS_FEED = url("/status/feed.xml");

/* ── Formatting ──────────────────────────────────────────────────────────── */

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const dateLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** "Oct 19, 2026 - 14:25 UTC", the way the incident updates read. */
const stamp = (ms: number): string => {
  const date = new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date} - ${time} UTC`;
};

const count = (value: number): string => value.toLocaleString("en-US");

const speed = (value: number | null): string | null => {
  if (value === null || value <= 0) return null;
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${String(Math.round(value))}ms`;
};

const percent = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)}%`);

const dayTip = (day: StatusDay): string => {
  const label = dayLabel(day.day);
  if (day.turns === 0) return `${label}: no requests`;
  const errors =
    day.errors === 0 ? "no errors" : `${count(day.errors)} error${day.errors === 1 ? "" : "s"}`;
  const average = speed(day.avgMs);
  return `${label}: ${count(day.turns)} request${day.turns === 1 ? "" : "s"}, ${errors}${
    average === null ? "" : `, ${average} average`
  }`;
};

const OVERALL_NOTES: Record<string, string> = {
  operational: "No open incident. Every included model with traffic is answering normally.",
  degraded: "No incident is open, but some models are above their usual error rate.",
  outage: "No incident note is posted yet, but some models are failing requests.",
  maintenance: "Maintenance is scheduled or in progress.",
};

const INCIDENT_BANNER_STATE: Record<string, string> = {
  critical: "outage",
  major: "outage",
  minor: "degraded",
  maintenance: "maintenance",
  none: "maintenance",
};

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function OverallBanner({ overall, asOf }: { overall: StatusView["overall"]; asOf: number }) {
  return (
    <div className="status-banner" data-state={overall.state} role="status">
      <span className="status-pulse" aria-hidden="true" />
      <div className="status-banner-copy">
        <strong>{overall.title}</strong>
        <span className="status-banner-note">{OVERALL_NOTES[overall.state] ?? ""}</span>
      </div>
      <time className="status-banner-time" dateTime={new Date(asOf).toISOString()}>
        {`As of ${stamp(asOf)}`}
      </time>
    </div>
  );
}

function IncidentBanner({ incident }: { incident: StatusIncident }) {
  const latest = incident.updates[0];
  const at = latest?.createdAt ?? incident.updatedAt;
  return (
    <div
      className="status-banner"
      data-state={INCIDENT_BANNER_STATE[incident.impact] ?? "degraded"}
      role="status"
    >
      <span className="status-pulse" aria-hidden="true" />
      <div className="status-banner-copy">
        <strong>{incident.title}</strong>
        {latest !== undefined && (
          <span className="status-banner-note">
            <b>{INCIDENT_STATUS_LABELS[latest.status] ?? latest.status}</b>
            {` — ${latest.body}`}
          </span>
        )}
      </div>
      <time className="status-banner-time" dateTime={new Date(at).toISOString()}>
        {stamp(at)}
      </time>
    </div>
  );
}

function ModelRow({ model, index }: { model: StatusModel; index: number }) {
  const average = speed(model.avgMs);
  const uptime = model.uptimePct === null ? "No data" : `${model.uptimePct.toFixed(2)}%`;

  return (
    <article className="status-row" data-state={model.state} style={{ animationDelay: `${String(index * 70)}ms` }}>
      <div className="status-row-head">
        <div className="status-row-name">
          <strong>{model.name}</strong>
          <span className="status-row-meta">
            <span className="status-row-provider">{model.providerName}</span>
            {` · ${count(model.turns)} turns · ${
              model.errorPct === null ? "error rate unknown" : `${model.errorPct.toFixed(2)}% errors`
            }${average === null ? "" : ` · ${average} average`}`}
          </span>
        </div>
        <span className="status-state" data-state={model.state}>
          <i className="status-state-dot" aria-hidden="true" />
          {LEVEL_LABELS[model.state] ?? model.state}
        </span>
      </div>
      <div
        className="status-bars"
        role="img"
        aria-label={`Uptime over the past ${String(model.days.length)} days for ${model.name}: ${uptime}.`}
      >
        {model.days.map((day, dayIndex) => (
          <span
            key={day.day}
            className="status-day"
            data-level={day.level}
            title={dayTip(day)}
            style={{ animationDelay: `${String(Math.min(dayIndex * 6, 540))}ms` }}
          >
            <span className="status-day-tip">{dayTip(day)}</span>
          </span>
        ))}
      </div>
      <div className="status-row-foot">
        <span>{`${String(model.days.length)} days ago`}</span>
        <span className="status-uptime">
          <strong>{uptime}</strong> <em>uptime</em>
        </span>
        <span>Today</span>
      </div>
    </article>
  );
}

function IncidentCard({ incident }: { incident: StatusIncident }) {
  return (
    <article className="status-incident" data-status={incident.status} id={incident.incidentId}>
      <header className="status-incident-head">
        <h4>{incident.title}</h4>
        <span className="status-impact" data-impact={incident.impact}>
          {IMPACT_LABELS[incident.impact] ?? incident.impact}
        </span>
      </header>
      {incident.updates.length > 0 && (
        <ol className="status-updates">
          {incident.updates.map((update) => (
            <li key={update.updateId} data-status={update.status}>
              <span className="status-update-pin" aria-hidden="true" />
              <div className="status-update-body">
                <p>
                  <strong>{INCIDENT_STATUS_LABELS[update.status] ?? update.status}</strong>
                  {` — ${update.body}`}
                </p>
                <time dateTime={new Date(update.createdAt).toISOString()}>{stamp(update.createdAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/**
 * The incident log, newest day first. The two days before today are shown even when
 * nothing happened on them: an empty "today" is the answer to "is anything wrong right
 * now", and a log that only lists bad days reads as if every day was one.
 */
function incidentGroups(
  incidents: StatusIncident[],
  nowMs: number,
): { key: string; label: string; incidents: StatusIncident[] }[] {
  const utcDayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const byDay = new Map<string, StatusIncident[]>();
  for (const incident of incidents) {
    const key = utcDayKey(incident.createdAt);
    byDay.set(key, [...(byDay.get(key) ?? []), incident]);
  }

  const today = utcDayKey(nowMs);
  const yesterday = utcDayKey(nowMs - 86_400_000);
  const dayBefore = utcDayKey(nowMs - 2 * 86_400_000);
  const keys = [...new Set([today, yesterday, dayBefore, ...byDay.keys()])].sort((a, b) =>
    b.localeCompare(a),
  );

  return keys.map((key) => ({
    key,
    label: key === today ? "Today" : key === yesterday ? "Yesterday" : dateLabel(Date.parse(`${key}T00:00:00Z`)),
    incidents: byDay.get(key) ?? [],
  }));
}

/**
 * Email alerts, with no account: a plain form that posts to the API and lands on
 * /status/subscription, so it works with the page's no-script rule. Both lists start ticked
 * because that is what almost everyone arriving here wants; the address is confirmed by one
 * email before anything else is sent.
 */
function Subscribe({ copy }: { copy: string }) {
  return (
    <section className="status-subscribe" id="subscribe" aria-labelledby="status-subscribe-heading">
      <div className="status-subscribe-copy">
        <span className="status-subscribe-kicker">Email alerts</span>
        <strong id="status-subscribe-heading">Know the moment a model has trouble</strong>
        <p>
          We email you when an included model starts failing requests, and again when it is back to
          normal - measured automatically, every 15 minutes. No account needed: confirm your address
          once and you are set.
        </p>
      </div>

      <form className="status-subscribe-form" method="post" action="/v1/status/subscribe">
        <div className="status-subscribe-row">
          <label className="sr-only" htmlFor="status-email">Email address</label>
          <input
            id="status-email"
            className="status-subscribe-input"
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            placeholder="you@example.com"
          />
          <button type="submit" className="status-subscribe-submit">Get alerts</button>
        </div>
        <fieldset className="status-topics">
          <legend className="sr-only">What to email you about</legend>
          <label className="status-topic">
            <input type="checkbox" name="models" defaultChecked />
            <span>
              <b>Model health</b>
              <small>Degraded, outage, and back to normal</small>
            </span>
          </label>
          <label className="status-topic">
            <input type="checkbox" name="incidents" defaultChecked />
            <span>
              <b>Incident updates</b>
              <small>What we know, as we post it</small>
            </span>
          </label>
        </fieldset>
        {/* Never seen by a person; a bot that fills every field fills this one too. */}
        <input className="status-subscribe-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <p className="status-subscribe-fine">
          From noreply@bluethenics.com. Every email has a one-click unsubscribe, and the address is
          used for nothing else. <a href="/privacy">Privacy</a>
        </p>
      </form>

      <div className="status-subscribe-more">
        <div>
          <strong>Prefer a feed?</strong>
          <p>
            Incident updates also publish to RSS - add it to a feed reader, Slack or Discord. With an ADCode
            account you can also get a note when a new free model arrives.{" "}
            <a href="/dashboard#email-preferences">Account emails</a>
          </p>
        </div>
        <CopyField label="Status feed" value={STATUS_FEED} />
        <small>{copy}</small>
      </div>
    </section>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default async function StatusPage() {
  const status = await readStatus();
  const active = status === null ? [] : status.incidents.filter((incident) => incident.status !== "resolved");

  return (
    <section className="public-glass-page status-page">
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Status", path: "/status" },
        ])}
      />
      <div className="marketplace-wrap">
        <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Status" }]} />
        <header className="public-glass-hero status-hero">
          <span className="glass-kicker">Live service health</span>
          <h1>ADCode status</h1>
          <p>
            Uptime and error rates for the AI models included with ADCode, measured from the assistant turns
            people actually ran. A turn counts against a model only when the service failed it - not when
            someone was signed out, out of credit, offline, or stopped it. Incidents are posted here by hand,
            with updates as they happen.
          </p>
          <div className="status-hero-actions">
            <a className="status-subscribe-button" href="#subscribe">
              Get email alerts
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </header>

        {status === null ? (
          <div className="status-banner" data-state="maintenance" role="status">
            <span className="status-pulse" aria-hidden="true" />
            <div className="status-banner-copy">
              <strong>Status data is unavailable right now</strong>
              <span className="status-banner-note">
                The service that measures model health is not answering. It is usually back within
                minutes; this page reads it again every minute.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="status-banners">
              {active.length === 0 ? (
                <OverallBanner overall={status.overall} asOf={status.asOf} />
              ) : (
                active.map((incident) => <IncidentBanner key={incident.incidentId} incident={incident} />)
              )}
            </div>

            <section className="status-section" id="models" aria-labelledby="status-models-heading">
              <div className="status-section-head">
                <h2 id="status-models-heading">Models</h2>
                <span className="status-window">{`Uptime over the past ${String(status.windowDays)} days`}</span>
              </div>
              {status.models.length === 0 ? (
                <p className="status-none">
                  {`No model has served a request in the past ${String(status.windowDays)} days yet. Each one appears here, with real numbers, as soon as people use it.`}
                </p>
              ) : (
                <div className="status-rows">
                  {status.models.map((model, index) => (
                    <ModelRow key={`${model.provider}:${model.model}`} model={model} index={index} />
                  ))}
                </div>
              )}
            </section>

            <section className="status-section" aria-labelledby="status-history-heading" id="incidents">
              <div className="status-section-head">
                <h2 id="status-history-heading">Past incidents</h2>
              </div>
              {incidentGroups(status.incidents, status.asOf).map((group) => (
                <div className="status-day-group" key={group.key}>
                  <h3>{group.label}</h3>
                  {group.incidents.length === 0 ? (
                    <p className="status-none">
                      {group.label === "Today" ? "No incidents reported today." : "No incidents reported."}
                    </p>
                  ) : (
                    <div className="status-incidents">
                      {group.incidents.map((incident) => (
                        <IncidentCard key={incident.incidentId} incident={incident} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </>
        )}

        <Subscribe copy="Model health updates itself; this feed carries the incidents, the moment they are posted." />
      </div>
    </section>
  );
}
