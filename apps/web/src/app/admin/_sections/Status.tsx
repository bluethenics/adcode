"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { LEVEL_LABELS, parseStatusView, type StatusView } from "@/lib/statusView";
import { when } from "@/components/money";
import "@/components/adminStatus.css";

interface StatusUpdate {
  updateId: string;
  status: string;
  body: string;
  createdAt: number;
}

interface StatusIncident {
  incidentId: string;
  title: string;
  impact: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  updates: StatusUpdate[];
}

/** Local copies of the vocabulary `services/api/src/status.ts` accepts, with the panel's voice. */
const IMPACTS = [
  { value: "minor", label: "Minor — some people, some requests" },
  { value: "major", label: "Major — most people affected" },
  { value: "critical", label: "Critical — the service is unusable" },
  { value: "maintenance", label: "Maintenance — planned work" },
  { value: "none", label: "Informational — nothing is broken" },
] as const;

const STATES = [
  { value: "investigating", label: "Investigating" },
  { value: "identified", label: "Identified" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
] as const;

const IMPACT_LABEL: Record<string, string> = {
  none: "Informational",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  maintenance: "Maintenance",
};

const STATE_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

/**
 * The public status page's incident log, written here.
 *
 * Model health is not managed from this page on purpose - it is measured, not typed. What
 * an admin writes is the part no measurement can say: that somebody knows, what is
 * happening, and when it stopped. Each update publishes to /status and its feed the moment
 * it lands, so an incident is one form away from being told.
 */
export function StatusBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<StatusIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<string>("major");
  const [state, setState] = useState<string>("investigating");
  const [body, setBody] = useState("");

  const [drafts, setDrafts] = useState<Record<string, { status: string; body: string }>>({});
  const [emailed, setEmailed] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState<StatusView["overall"] | null>(null);
  const [subscribers, setSubscribers] = useState<{ active: number; models: number; incidents: number; pending: number } | null>(null);

  const load = useCallback(async () => {
    const auth = await token();
    const [found, publicView, lists] = await Promise.all([
      apiFetch<{ incidents: StatusIncident[] }>({ path: "/admin/status", token: auth }),
      apiFetch<unknown>({ path: "/status", token: auth }),
      apiFetch<{ active: number; models: number; incidents: number; pending: number }>({ path: "/admin/status/subscribers", token: auth }),
    ]);
    if (found.ok) setRows(found.value.incidents);
    else setError(MESSAGES[found.error]);
    if (publicView.ok) setOverall(parseStatusView(publicView.value)?.overall ?? null);
    if (lists.ok) setSubscribers(lists.value);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (title.trim().length === 0 || body.trim().length === 0) {
      setError("An incident needs a title and at least one update sentence.");
      return;
    }

    setBusy(true);
    setError(null);
    setPosted(null);

    const result = await apiFetch<StatusIncident>({
      path: "/admin/status/incidents",
      token: await token(),
      method: "POST",
      body: { title: title.trim(), impact, status: state, body: body.trim() },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setPosted(result.value.title);
    setTitle("");
    setBody("");
    setState("investigating");
    void load();
  };

  const addUpdate = async (incidentId: string) => {
    if (busy) return;
    const draft = drafts[incidentId] ?? { status: "identified", body: "" };
    if (draft.body.trim().length === 0) {
      setError("An update needs a sentence.");
      return;
    }

    setBusy(true);
    setError(null);
    setPosted(null);

    const result = await apiFetch<StatusIncident>({
      path: `/admin/status/incidents/${encodeURIComponent(incidentId)}/updates`,
      token: await token(),
      method: "POST",
      body: { status: draft.status, body: draft.body.trim() },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setPosted(`${result.value.title} — ${STATE_LABEL[result.value.status] ?? result.value.status}`);
    setDrafts((current) => ({ ...current, [incidentId]: { status: draft.status, body: "" } }));
    void load();
  };

  /** Queues the incident's newest update for status subscribers; the server refuses a repeat. */
  const emailSubscribers = async (incidentId: string): Promise<void> => {
    setBusy(true);
    const result = await apiFetch<{ queued: number; sendingEnabled: boolean }>({
      path: "/admin/email/announce",
      token: await token(),
      method: "POST",
      body: { topic: "status", incident: incidentId },
    });
    setBusy(false);
    const said = !result.ok
      ? result.error === "invalid-state" ? "This update was already emailed." : "Could not queue the email. Try again."
      : result.value.sendingEnabled
        ? `Queued for ${result.value.queued} ${result.value.queued === 1 ? "person" : "people"}, account holders and status-page subscribers together.`
        : `Queued for ${result.value.queued}, but sending is switched off until a postal address is set.`;
    setEmailed((current) => ({ ...current, [incidentId]: said }));
  };

  const setDraft = (incidentId: string, patch: Partial<{ status: string; body: string }>): void =>
    setDrafts((current) => ({
      ...current,
      [incidentId]: { status: "identified", body: "", ...current[incidentId], ...patch },
    }));

  if (loading) return <p className="lede">Loading…</p>;

  const active = rows.filter((incident) => incident.status !== "resolved");
  const sorted = [...active, ...rows.filter((incident) => incident.status === "resolved")];

  return (
    <div className="adm-status">
      <div className="adm-status-summary">
        <div className="adm-card">
          <span className="adm-summary-label">The public page says</span>
          <span className="adm-summary-value">
            <span className="adm-dot" data-state={overall?.state ?? "unknown"} aria-hidden="true" />
            {overall === null ? "Unavailable" : overall.title}
          </span>
          <span className="adm-summary-sub">
            {overall === null ? "The status service did not answer." : LEVEL_LABELS[overall.state] ?? overall.state} ·{" "}
            <a href="/status" target="_blank" rel="noreferrer">Open ↗</a>
          </span>
        </div>
        <div className="adm-card">
          <span className="adm-summary-label">Open incidents</span>
          <span className="adm-summary-value is-number">{active.length}</span>
          <span className="adm-summary-sub">{rows.length - active.length} resolved in the log</span>
        </div>
        <div className="adm-card">
          <span className="adm-summary-label">Email alert subscribers</span>
          <span className="adm-summary-value is-number">{subscribers === null ? "—" : subscribers.active.toLocaleString("en-US")}</span>
          <span className="adm-summary-sub">
            {subscribers === null
              ? "Counts unavailable"
              : `${subscribers.models.toLocaleString("en-US")} model health · ${subscribers.incidents.toLocaleString("en-US")} ${subscribers.incidents === 1 ? "incident" : "incidents"} · ${subscribers.pending.toLocaleString("en-US")} unconfirmed`}
          </span>
        </div>
      </div>

      {(error !== null || posted !== null) && (
        <div>
          {error !== null && (
            <div className="notice" data-tone="error" role="alert">
              {error}
            </div>
          )}
          {posted !== null && (
            <div className="notice" data-tone="ok" role="status">
              Published: {posted}. It is on the status page and its feed now.
            </div>
          )}
        </div>
      )}

      <div className="adm-status-columns">
        <form onSubmit={open} className="adm-card">
          <header className="adm-card-head">
            <div>
              <h2>Open an incident</h2>
              <p>Publishes to /status and its RSS feed the moment you post. Write for someone reading cold.</p>
            </div>
          </header>
        <div className="field">
          <label htmlFor="s-title">Title</label>
          <span className="field-hint">{title.length}/120. What is happening, seen from outside — &ldquo;Elevated errors on free models&rdquo;.</span>
          <input
            id="s-title"
            className="input"
            maxLength={120}
            placeholder="Elevated errors on free models"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="s-impact">Impact</label>
          <select id="s-impact" className="select" value={impact} onChange={(event) => setImpact(event.target.value)}>
            {IMPACTS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="s-state">State</label>
          <select id="s-state" className="select" value={state} onChange={(event) => setState(event.target.value)}>
            {STATES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="s-body">First update</label>
          <span className="field-hint">
            {body.length}/2000. What you know so far, in one or two sentences. &ldquo;We are investigating&rdquo;
            is a full update; saying nothing is not.
          </span>
          <textarea
            id="s-body"
            className="textarea"
            maxLength={2000}
            placeholder="Requests to free models are failing for some people. We are looking now."
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Posting…" : "Post to the status page"}
          </button>
          <a className="btn btn-outline" href="/status" target="_blank" rel="noreferrer">
            View the public page
          </a>
        </div>
      </form>


        <div className="adm-stack">
          <section className="adm-card" aria-labelledby="adm-auto-heading">
            <header className="adm-card-head">
              <div>
                <h2 id="adm-auto-heading">What sends itself</h2>
                <p>Nothing to do here. This is what subscribers receive without you.</p>
              </div>
            </header>
            <ul className="adm-auto">
              <li><b>Every 15 min</b><span>Each included model is judged on the turns since the last check. Model-health subscribers are emailed when one degrades or fails, and again after two good checks in a row.</span></li>
              <li><b>Bars</b><span>Uptime and error rates on /status are measured, never typed. Under 10 turns in a window there is no verdict either way.</span></li>
              <li><b>Sender</b><span>noreply@bluethenics.com, with a one-click unsubscribe in every email.</span></li>
            </ul>
          </section>
          <ModelEmails />
        </div>
      </div>

      <section aria-labelledby="adm-incidents-heading">
        <header className="adm-section-head">
          <h2 id="adm-incidents-heading">Incidents</h2>
          <span className="adm-section-meta">Open first, then newest</span>
        </header>
      {rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing posted</h3>
          <p>Incidents you open appear here, resolved ones included, with every update you posted.</p>
        </div>
      ) : (
        <div className="adm-incidents">
          {sorted.map((incident) => {
            const draft = drafts[incident.incidentId] ?? { status: incident.status === "resolved" ? "investigating" : "identified", body: "" };
            return (
              <article className="adm-incident" key={incident.incidentId} data-status={incident.status}>
                <header className="adm-incident-head">
                  <div>
                    <h3>{incident.title}</h3>
                    <p className="adm-incident-meta">
                      {IMPACT_LABEL[incident.impact] ?? incident.impact} impact · opened {when(incident.createdAt)}
                      {incident.resolvedAt === null ? "" : ` · resolved ${when(incident.resolvedAt)}`}
                    </p>
                  </div>
                  <span className="adm-chip" data-status={incident.status}>{STATE_LABEL[incident.status] ?? incident.status}</span>
                </header>

                <ol className="adm-timeline">
                  {incident.updates.map((update) => (
                    <li key={update.updateId}>
                      <p>
                        <strong>{STATE_LABEL[update.status] ?? update.status}</strong> — {update.body}
                      </p>
                      <time dateTime={new Date(update.createdAt).toISOString()}>{when(update.createdAt)}</time>
                    </li>
                  ))}
                </ol>

                {/* Status emails go only to people who ticked "email me about outages", once per update. */}
                <div className="adm-incident-actions">
                  <button type="button" className="btn btn-outline btn-small" disabled={busy || incident.updates.length === 0} onClick={() => void emailSubscribers(incident.incidentId)}>
                    Email subscribers the latest update
                  </button>
                  {emailed[incident.incidentId] !== undefined && <span className="field-hint">{emailed[incident.incidentId]}</span>}
                </div>

                <details className="admin-status-compose">
                  <summary>{incident.status === "resolved" ? "Reopen or add an update" : "Add an update"}</summary>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor={`u-state-${incident.incidentId}`}>State</label>
                    <select
                      id={`u-state-${incident.incidentId}`}
                      className="select"
                      value={draft.status}
                      onChange={(event) => setDraft(incident.incidentId, { status: event.target.value })}
                    >
                      {STATES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`u-body-${incident.incidentId}`}>Update</label>
                    <span className="field-hint">
                      {draft.body.length}/2000. Posting &ldquo;Resolved&rdquo; closes the incident; any other state
                      on a closed one reopens it.
                    </span>
                    <textarea
                      id={`u-body-${incident.incidentId}`}
                      className="textarea"
                      maxLength={2000}
                      placeholder="The fix is deployed and errors are back to normal. We are watching for a while."
                      value={draft.body}
                      onChange={(event) => setDraft(incident.incidentId, { body: event.target.value })}
                    />
                  </div>
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void addUpdate(incident.incidentId)}>
                      {busy ? "Posting…" : "Post update"}
                    </button>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      </section>

      <p className="adm-footnote">
        An incident is a record: nothing here can be deleted. Correcting something means
        posting the correction, the way it works for everyone reading.
      </p>
    </div>
  );
}

/**
 * Model emails go only to people who ticked "email me about the AI models". A new-model email names
 * a model from the included catalog with the administrator's one-paragraph summary; the performance
 * report is built by the server from the same measurements as /status and cannot be typed over.
 */
function ModelEmails() {
  const { token } = useAuth();
  const [models, setModels] = useState<Array<{ model: string; name: string }>>([]);
  const [model, setModel] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const found = await apiFetch<{ models: Array<{ model: string; name: string }> }>({ path: "/status", token: await token() });
      if (found.ok) setModels(found.value.models.map(({ model: id, name }) => ({ model: id, name })));
    })();
  }, [token]);

  const send = async (body: Record<string, unknown>, what: string): Promise<void> => {
    setBusy(true);
    setSaid(null);
    const result = await apiFetch<{ queued: number; sendingEnabled: boolean }>({ path: "/admin/email/announce", token: await token(), method: "POST", body: { topic: "models", ...body } });
    setBusy(false);
    setSaid(!result.ok
      ? result.error === "invalid-state" ? `${what} was already emailed today, or there is no model data yet.` : `Could not queue ${what}. Try again.`
      : result.value.sendingEnabled
        ? `${what}: queued for ${result.value.queued} ${result.value.queued === 1 ? "person" : "people"}; the hourly sender delivers it.`
        : `${what}: queued for ${result.value.queued}, but sending is switched off until a postal address is set.`);
  };

  return (
    <section className="adm-card" aria-labelledby="adm-model-emails-heading">
      <header className="adm-card-head">
        <div>
          <h2 id="adm-model-emails-heading">Email account holders about models</h2>
          <p>Only ADCode accounts that ticked &ldquo;email me about the AI models&rdquo;. Each one goes out once.</p>
        </div>
      </header>
      <div className="actions" style={{ marginBottom: 18 }}>
        <button type="button" className="btn btn-outline btn-small" disabled={busy} onClick={() => void send({ performance: true }, "The performance report")}>
          Email the last 30 days of model performance
        </button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (model !== "" && summary.trim() !== "") void send({ model, summary: summary.trim() }, "The new-model email"); }}>
        <div className="field">
          <label htmlFor="m-model">New free model</label>
          <select id="m-model" className="select" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="">Choose a model</option>
            {models.map((entry) => <option key={entry.model} value={entry.model}>{entry.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-summary">What it is good at</label>
          <span className="field-hint">{summary.length}/600. One short paragraph, written for someone choosing a model.</span>
          <textarea id="m-summary" className="textarea" maxLength={600} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-outline btn-small" disabled={busy || model === "" || summary.trim() === ""}>Email the new model</button>
        </div>
      </form>
      {said !== null && <p className="field-hint" role="status" style={{ marginTop: 10 }}>{said}</p>}
    </section>
  );
}
