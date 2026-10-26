/**
 * Telling people about a release, new docs, a status-page update, a new free model or how the
 * models have been performing - by email, to the ones who asked.
 *
 * Every announcement is a snapshot: the administrator chooses what to announce, this builds the
 * email's words from the record as it stands (a published release note, an incident's newest
 * update, a docs page's title and summary, the included-model catalog, or the status page's own
 * measurements), and the mailing queue sends it to the people whose consent covers it - ADCode
 * updates for releases and docs, the separate status yes for status updates, the separate model
 * yes for model emails. Announcing the same thing twice queues nothing the second time, so a
 * double click cannot email anyone twice.
 */
import type { Clock, Store } from "./store.ts";
import type { AnnouncementPayload, AnnouncementTopic, MailingStore } from "./mailing.ts";
import { readStatusView, statusCatalog, type StatusModelView } from "./status.ts";
import type { StatusAlertStore } from "./statusAlerts.ts";

export interface AnnounceDeps {
  store: Store;
  clock: Clock;
  mailing?: MailingStore;
  /** The status page's own subscribers, who also hear about incident updates. */
  statusAlerts?: StatusAlertStore;
  siteOrigin: string;
}

export type AnnounceOutcome =
  | { status: 200; body: { queued: number; sendingEnabled: boolean } }
  | { status: 400 | 404 | 409 | 503; body: { error: string } };

const STATUS_WORDS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Cause found",
  monitoring: "Fix in place, watching",
  resolved: "Resolved",
};

/** The first paragraph of a markdown note, as plain text, short enough for an email's opening line. */
export function plainSummary(markdown: string, limit = 400): string {
  const paragraph = markdown.split(/\n\s*\n/).map((part) => part.trim()).find((part) => part.length > 0 && !part.startsWith("#")) ?? "";
  const plain = paragraph
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

const DOCS_PATH = /^\/docs(?:\/[a-z0-9][a-z0-9-]*)+$/;

/** How many days a model performance report covers. */
export const MODEL_REPORT_DAYS = 30;

/** One line per included model that ran in the window, busiest first, in the status page's own numbers. */
export function modelReportLines(models: readonly StatusModelView[]): string[] {
  return models
    .filter((model) => model.turns > 0 && model.uptimePct !== null)
    .sort((a, b) => b.turns - a.turns)
    .slice(0, 8)
    .map((model) => {
      const speed = model.avgMs === null ? "" : `, ${(model.avgMs / 1000).toFixed(1)} s average turn`;
      return `${model.name}: ${model.uptimePct!.toFixed(2)}% of ${model.turns.toLocaleString("en-US")} turns answered${speed}`;
    });
}

export async function handleAnnounce(deps: AnnounceDeps, adminUid: string, raw: unknown): Promise<AnnounceOutcome> {
  if (deps.mailing === undefined) return { status: 503, body: { error: "mailing-unavailable" } };
  const fields = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const topic = fields?.["topic"];
  if (fields === null || (topic !== "product" && topic !== "status" && topic !== "models")) return { status: 400, body: { error: "malformed-announcement" } };

  let ref: string, subject: string, payload: AnnouncementPayload;
  if (topic === "models") {
    const keys = Object.keys(fields).filter((key) => key !== "topic");
    if (keys.length === 1 && keys[0] === "performance" && fields["performance"] === true) {
      // The report is the status page's own measurement, never typed in: one per UTC day at most.
      const view = await readStatusView({ store: deps.store, clock: deps.clock }, MODEL_REPORT_DAYS);
      const lines = modelReportLines(view.models);
      if (lines.length === 0) return { status: 409, body: { error: "no-model-data" } };
      const day = new Date(view.asOf).toISOString().slice(0, 10);
      ref = `performance:${day}`;
      subject = `How ADCode's free AI models performed: the last ${MODEL_REPORT_DAYS} days`;
      payload = {
        title: `Model performance, last ${MODEL_REPORT_DAYS} days`,
        summary: `How often each free model answered, measured from the turns people actually ran. A turn counts against a model only when the service failed it. Right now: ${view.overall.title}.`,
        highlights: lines,
        url: `${deps.siteOrigin}/status`,
      };
    } else if (keys.length === 2 && keys.includes("model") && keys.includes("summary")) {
      // A new model: the name comes from the included catalog, so an email cannot announce a model people cannot pick.
      const id = fields["model"], summary = typeof fields["summary"] === "string" ? fields["summary"].trim() : "";
      if (typeof id !== "string" || summary.length === 0 || summary.length > 600) return { status: 400, body: { error: "malformed-announcement" } };
      const catalogName = statusCatalog(await deps.store.getTagflowConfig())?.get(id)?.name;
      if (catalogName === undefined) return { status: 404, body: { error: "not-found" } };
      ref = `model:${id}`;
      subject = `New free model in ADCode: ${catalogName}`;
      payload = { title: `${catalogName} is now free in ADCode`, summary, url: `${deps.siteOrigin}/status` };
    } else {
      return { status: 400, body: { error: "malformed-announcement" } };
    }
  } else if (topic === "status") {
    const incidentId = fields["incident"];
    if (typeof incidentId !== "string" || incidentId.length === 0 || Object.keys(fields).some((key) => key !== "topic" && key !== "incident")) {
      return { status: 400, body: { error: "malformed-announcement" } };
    }
    const incident = await deps.store.getStatusIncident(incidentId);
    if (incident === null) return { status: 404, body: { error: "not-found" } };
    const latest = (await deps.store.listStatusIncidentUpdates())
      .filter((update) => update.incidentId === incidentId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest === undefined) return { status: 409, body: { error: "no-update" } };
    const word = STATUS_WORDS[latest.status] ?? latest.status;
    ref = `${incidentId}/${latest.updateId}`;
    subject = `${word}: ${incident.title}`;
    payload = { title: incident.title, summary: latest.body.trim(), status: latest.status, url: `${deps.siteOrigin}/status` };
  } else if (typeof fields["release"] === "string") {
    if (Object.keys(fields).some((key) => key !== "topic" && key !== "release")) return { status: 400, body: { error: "malformed-announcement" } };
    const release = await deps.store.getRelease(fields["release"]);
    if (release === null) return { status: 404, body: { error: "not-found" } };
    if (release.status !== "published") return { status: 409, body: { error: "not-published" } };
    ref = `release:${release.version}`;
    subject = release.title.includes(release.version) ? release.title : `ADCode ${release.version}: ${release.title}`;
    payload = { title: release.title, summary: plainSummary(release.body), highlights: release.highlights.slice(0, 5), url: `${deps.siteOrigin}/versions` };
  } else {
    const docs = fields["docs"];
    const page = typeof docs === "object" && docs !== null && !Array.isArray(docs) ? docs as Record<string, unknown> : null;
    const path = typeof page?.["path"] === "string" ? page["path"] : "";
    const title = typeof page?.["title"] === "string" ? page["title"].trim() : "";
    const summary = typeof page?.["summary"] === "string" ? page["summary"].trim() : "";
    if (page === null || Object.keys(fields).some((key) => key !== "topic" && key !== "docs") || Object.keys(page).some((key) => !["path", "title", "summary"].includes(key)) ||
        !DOCS_PATH.test(path) || title.length === 0 || title.length > 120 || summary.length === 0 || summary.length > 600) {
      return { status: 400, body: { error: "malformed-announcement" } };
    }
    ref = `docs:${path}`;
    subject = `New in the ADCode docs: ${title}`;
    payload = { title, summary, url: `${deps.siteOrigin}${path}` };
  }

  const now = deps.clock.now();
  const accounts = await deps.mailing.announce({ topic: topic as AnnouncementTopic, ref, subject: subject.slice(0, 200), payload, by: adminUid, now });
  // An incident update also reaches everyone who joined the status page's incident list without an account.
  const visitors = topic === "status" && deps.statusAlerts !== undefined
    ? await deps.statusAlerts.queueAlert({ topic: "incidents", ref, subject: subject.slice(0, 200), payload: { title: payload.title, summary: payload.summary, status: payload.status ?? "investigating", url: `${deps.siteOrigin}/status#incidents` }, now })
    : -1;
  if (accounts < 0 && visitors < 0) return { status: 409, body: { error: "already-announced" } };
  const queued = Math.max(accounts, 0) + Math.max(visitors, 0);
  await deps.store.writeAudit({ adminUid, action: `announce:${topic}:${ref}`, subjectUid: "*", at: now });
  return { status: 200, body: { queued, sendingEnabled: (await deps.mailing.settings()).enabled } };
}
