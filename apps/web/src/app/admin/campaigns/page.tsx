"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { AdminLoader, LoaderMark } from "@/components/AdminLoader";
import {
  campaignProgress, consoleCall, rate,
  type CampaignAudience, type CampaignDetail, type CampaignDraft, type CampaignView,
} from "@/lib/adminConsoleClient";
import { ago } from "../_sections/People";

/**
 * Email campaigns: write one message, cap it, and let it drip out.
 *
 * "Send 1,000 emails, 50 a day, to people who haven't opened ADCode in two weeks" is the whole
 * shape. The database does the rest every 15 minutes: it paces the daily cap across the day,
 * skips anyone who unsubscribed, bounced or complained, never emails one address twice for the
 * same campaign or more than once in three days across campaigns, and stops when the total is
 * reached or nobody is left. A campaign starts as a draft, so it can be tested on yourself first.
 */
export default function CampaignsPage() {
  return <Suspense fallback={null}><CampaignsBody /></Suspense>;
}

const number = new Intl.NumberFormat("en-US");
const STATUS_LABEL: Record<CampaignView["status"], string> = { draft: "Draft", running: "Sending", paused: "Paused", completed: "Finished", cancelled: "Cancelled" };
const STATUS_TONE: Record<CampaignView["status"], string> = { draft: "quiet", running: "ok", paused: "warn", completed: "info", cancelled: "bad" };
const FINISH: Record<string, string> = { "total-reached": "Reached its total", "audience-exhausted": "Reached everyone it could", cancelled: "Cancelled" };

const BLANK: CampaignDraft = {
  name: "Come back to ADCode",
  subject: "{{name}}, your workspace is still here",
  preheader: "Free AI, a focused editor, and your projects where you left them.",
  heading: "Pick up where you left off.",
  body: "Hi {{name}},\n\nIt's been a while since you opened ADCode. A lot has changed: faster free models, agents that can work through a task with you, and a cleaner editor.\n\nYour projects are where you left them. Open ADCode and try one small thing today.",
  ctaLabel: "Open ADCode",
  ctaUrl: "https://adcode.bluethenics.com/",
  audience: "everyone",
  inactiveDays: 14,
  totalLimit: 1000,
  dailyLimit: 50,
};

function CampaignsBody() {
  const params = useSearchParams();
  const router = useRouter();
  const editing = params.get("edit");
  const creating = params.get("new") === "1";
  const viewing = params.get("id");
  const go = (query: string): void => router.push(`/admin/campaigns${query}`, { scroll: false });

  const title = creating ? "New campaign" : editing !== null ? "Edit campaign" : viewing !== null ? "Campaign" : "Email campaigns";
  return (
    <AdminShell
      title={title}
      subtitle={creating || editing !== null ? "Write it once, set the caps, test it on yourself, then start it." : "Messages you write, sent through Resend a few at a time, every 15 minutes."}
      tab="campaigns"
      actions={creating || editing !== null || viewing !== null
        ? <button type="button" className="btn btn-outline btn-small" onClick={() => go("")}>← All campaigns</button>
        : <button type="button" className="btn btn-small" onClick={() => go("?new=1")}>New campaign</button>}
    >
      {creating ? <Editor key="new" onSaved={(id) => go(`?id=${id}`)} />
        : editing !== null ? <Editor key={editing} id={editing} onSaved={(id) => go(`?id=${id}`)} />
          : viewing !== null ? <Detail id={viewing} onEdit={() => go(`?edit=${viewing}`)} />
            : <List onNew={() => go("?new=1")} />}
    </AdminShell>
  );
}

/* ── The list ────────────────────────────────────────────────────────────── */

function List({ onNew }: { onNew: () => void }) {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const found = await consoleCall<{ campaigns: CampaignView[] }>("/admin/campaigns", await token());
    if (found.ok) { setCampaigns(found.value.campaigns); setError(null); } else { setError(found.message); setCampaigns((was) => was ?? []); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (campaigns === null) return <AdminLoader label="Loading campaigns" shape="cards" />;
  const running = campaigns.filter((one) => one.status === "running");
  const sentAll = campaigns.reduce((total, one) => total + one.stats.sent, 0);
  const returnedAll = campaigns.reduce((total, one) => total + one.stats.returned, 0);
  const todayAll = campaigns.reduce((total, one) => total + one.stats.today, 0);

  return (
    <div className="adm-campaigns">
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      <dl className="adm-facts-grid adm-facts-wide">
        <div className="adm-fact"><dt>Sending now</dt><dd>{number.format(running.length)}</dd><p>{running.length === 0 ? "No campaign is running" : `${number.format(running.reduce((t, one) => t + one.dailyLimit, 0))} a day between them`}</p></div>
        <div className="adm-fact"><dt>Sent today</dt><dd>{number.format(todayAll)}</dd><p>Paced through the UTC day</p></div>
        <div className="adm-fact"><dt>Sent, all campaigns</dt><dd>{number.format(sentAll)}</dd><p>Accepted by Resend</p></div>
        <div className="adm-fact"><dt>Came back</dt><dd>{number.format(returnedAll)}</dd><p>{sentAll === 0 ? "Opened ADCode after an email" : `${rate(returnedAll, sentAll)} opened ADCode afterwards`}</p></div>
      </dl>

      {campaigns.length === 0 ? (
        <div className="adm-empty-state adm-empty-hero">
          <strong>No campaigns yet</strong>
          <p>Write a message, choose who gets it, and set a total and a daily limit - say 1,000 emails at 50 a day. It starts as a draft so you can send yourself a test first.</p>
          <button type="button" className="btn btn-small" onClick={onNew}>Write the first campaign</button>
        </div>
      ) : (
        <ul className="adm-campaign-list">
          {campaigns.map((campaign, index) => <CampaignCard key={campaign.id} campaign={campaign} index={index} onChanged={() => void load()} />)}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({ campaign, index, onChanged }: { campaign: CampaignView; index: number; onChanged: () => void }) {
  const progress = campaignProgress(campaign);
  return (
    <li className="adm-campaign" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }} data-status={campaign.status}>
      <div className="adm-campaign-top">
        <div>
          <Link href={`/admin/campaigns?id=${campaign.id}`} className="adm-campaign-name">{campaign.name}</Link>
          <p className="adm-campaign-subject">{campaign.subject}</p>
        </div>
        <b className="adm-chip" data-tone={STATUS_TONE[campaign.status]}>{campaign.status === "running" && <i className="adm-live" aria-hidden="true" />}{STATUS_LABEL[campaign.status]}</b>
      </div>
      <Progress campaign={campaign} />
      <div className="adm-campaign-foot">
        <span>
          {number.format(progress.done)} of {number.format(campaign.totalLimit)} · {number.format(campaign.dailyLimit)} a day
          {campaign.status === "running" || campaign.status === "paused" ? ` · about ${progress.daysLeft} day${progress.daysLeft === 1 ? "" : "s"} left` : ""}
          {campaign.finishReason !== null ? ` · ${FINISH[campaign.finishReason] ?? campaign.finishReason}` : ""}
        </span>
        <span className="adm-campaign-rates">
          <span title="Delivered">{rate(campaign.stats.delivered, campaign.stats.sent)} delivered</span>
          <span title="Clicked the button">{rate(campaign.stats.clicked, campaign.stats.sent)} clicked</span>
          <span title="Opened ADCode after the email">{number.format(campaign.stats.returned)} came back</span>
        </span>
      </div>
      <Controls campaign={campaign} onChanged={onChanged} />
    </li>
  );
}

function Progress({ campaign }: { campaign: CampaignView }) {
  const sent = campaign.totalLimit === 0 ? 0 : Math.min(1, campaign.stats.sent / campaign.totalLimit);
  const queued = campaign.totalLimit === 0 ? 0 : Math.min(1 - sent, campaign.stats.queued / campaign.totalLimit);
  return (
    <div className="adm-progress" role="img" aria-label={`${campaign.stats.sent} of ${campaign.totalLimit} sent`}>
      <span className="adm-progress-sent" style={{ transform: `scaleX(${sent})` }} />
      <span className="adm-progress-queued" style={{ transform: `scaleX(${sent + queued})` }} />
    </div>
  );
}

/** Start, pause, resume, test and cancel - the same buttons on a card and on the detail page. */
function Controls({ campaign, onChanged, onEdit }: { campaign: CampaignView; onChanged: () => void; onEdit?: () => void }) {
  const { token } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const state = async (status: "running" | "paused" | "cancelled"): Promise<void> => {
    setBusy(status); setMessage(null); setArmed(null);
    const result = await consoleCall<unknown>(`/admin/campaigns/${campaign.id}/state`, await token(), "POST", { status });
    setBusy(null);
    if (!result.ok) { setMessage({ tone: "error", text: result.message }); return; }
    onChanged();
  };
  const test = async (): Promise<void> => {
    setBusy("test"); setMessage(null);
    const result = await consoleCall<{ to: string }>(`/admin/campaigns/${campaign.id}/test`, await token(), "POST", {});
    setBusy(null);
    setMessage(result.ok ? { tone: "success", text: `Test sent to ${result.value.to}. It's marked [Test] and counts toward nothing.` } : { tone: "error", text: result.message });
  };
  const finished = campaign.status === "completed" || campaign.status === "cancelled";
  const editable = campaign.status === "draft" || campaign.status === "paused";

  return (
    <div className="adm-campaign-controls">
      {!finished && (
        campaign.status === "running"
          ? <button type="button" className="btn btn-outline btn-small" disabled={busy !== null} onClick={() => void state("paused")}>{busy === "paused" ? <LoaderMark size={14} /> : null}Pause</button>
          : <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => { if (campaign.status === "draft" && armed !== "start") { setArmed("start"); return; } void state("running"); }}>
              {busy === "running" ? <LoaderMark size={14} /> : null}{campaign.status === "draft" ? (armed === "start" ? "Confirm: start sending" : "Start sending") : "Resume"}
            </button>
      )}
      <button type="button" className="btn btn-outline btn-small" disabled={busy !== null} onClick={() => void test()}>{busy === "test" ? <><LoaderMark size={14} /> Sending</> : "Send me a test"}</button>
      {editable && <button type="button" className="btn btn-outline btn-small" onClick={() => (onEdit ?? (() => router.push(`/admin/campaigns?edit=${campaign.id}`)))()}>Edit</button>}
      {!finished && (
        <button type="button" className="btn btn-outline btn-small adm-quiet-danger" disabled={busy !== null} onClick={() => { if (armed !== "cancel") { setArmed("cancel"); return; } void state("cancelled"); }}>
          {armed === "cancel" ? "Confirm: cancel for good" : "Cancel"}
        </button>
      )}
      {message !== null && <p className="adm-inline-note" data-tone={message.tone} role="status">{message.text}</p>}
    </div>
  );
}

/* ── One campaign ────────────────────────────────────────────────────────── */

function Detail({ id, onEdit }: { id: string; onEdit: () => void }) {
  const { token } = useAuth();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const found = await consoleCall<CampaignDetail>(`/admin/campaigns/${encodeURIComponent(id)}`, await token());
    if (found.ok) { setCampaign(found.value); setError(null); } else setError(found.message);
  }, [id, token]);
  useEffect(() => { void load(); }, [load]);

  if (error !== null) return <div className="notice" data-tone="error" role="alert">{error}</div>;
  if (campaign === null) return <AdminLoader label="Opening the campaign" shape="detail" />;
  const s = campaign.stats;
  const progress = campaignProgress(campaign);
  const funnel = [
    { label: "Sent", value: s.sent },
    { label: "Delivered", value: s.delivered },
    { label: "Opened", value: s.opened },
    { label: "Clicked", value: s.clicked },
    { label: "Came back", value: s.returned },
  ];
  const top = Math.max(1, s.sent);

  return (
    <div className="adm-campaign-detail">
      <div className="adm-campaign adm-campaign-hero" data-status={campaign.status}>
        <div className="adm-campaign-top">
          <div>
            <h2 className="adm-campaign-name">{campaign.name}</h2>
            <p className="adm-campaign-subject">{campaign.subject}</p>
          </div>
          <b className="adm-chip" data-tone={STATUS_TONE[campaign.status]}>{campaign.status === "running" && <i className="adm-live" aria-hidden="true" />}{STATUS_LABEL[campaign.status]}</b>
        </div>
        <Progress campaign={campaign} />
        <div className="adm-campaign-foot">
          <span>{number.format(progress.done)} of {number.format(campaign.totalLimit)} · {number.format(s.today)} of {number.format(campaign.dailyLimit)} today · {campaign.audience === "everyone" ? "every verified account" : "people who said yes to updates"}{campaign.inactiveDays !== null ? `, inactive ${campaign.inactiveDays}+ days` : ""}</span>
          <span>{s.lastSentAt !== null ? `last sent ${ago(s.lastSentAt)}` : campaign.status === "running" ? "first emails go out within 15 minutes" : ""}</span>
        </div>
        <Controls campaign={campaign} onChanged={() => void load()} onEdit={onEdit} />
      </div>

      <div className="adm-detail-grid">
        <section className="adm-panel">
          <header className="adm-panel-head"><div><h2>What happened</h2><p>Opens depend on the reader's mail app loading images, so they undercount.</p></div></header>
          <ol className="adm-funnel">
            {funnel.map((step, index) => (
              <li key={step.label}>
                <span>{step.label}</span>
                <span className="adm-funnel-bar"><i style={{ transform: `scaleX(${step.value / top})`, transitionDelay: `${index * 60}ms` }} /></span>
                <b>{number.format(step.value)}</b>
                <em>{index === 0 ? "" : rate(step.value, s.sent)}</em>
              </li>
            ))}
          </ol>
          <ul className="adm-kv">
            <li><span>Waiting or retrying</span><b>{number.format(s.queued)}</b></li>
            <li><span>Failed</span><b>{number.format(s.failed)}</b></li>
            <li><span>Bounced</span><b>{number.format(s.bounced)}</b></li>
            <li><span>Marked as spam</span><b>{number.format(s.complained)}</b></li>
          </ul>
        </section>
        <section className="adm-panel">
          <header className="adm-panel-head"><div><h2>The email</h2><p>As recipients see it, with {"{{name}}"} filled in.</p></div></header>
          <EmailPreview draft={campaign} />
        </section>
      </div>

      <section className="adm-panel">
        <header className="adm-panel-head"><div><h2>Latest sends</h2><p>The 50 most recent. Addresses are shown so a reply or a complaint can be traced.</p></div></header>
        {campaign.sends.length === 0 ? <p className="field-hint">Nothing sent yet.</p> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Address</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th></tr></thead>
              <tbody>
                {campaign.sends.map((send) => (
                  <tr key={send.email}>
                    <td><Link href={`/admin/people?q=${encodeURIComponent(send.email)}`}>{send.email}</Link></td>
                    <td><b className="adm-chip" data-tone={send.status === "sent" ? (send.bouncedAt !== null ? "bad" : "ok") : send.status === "failed" ? "bad" : "quiet"}>{send.bouncedAt !== null ? "bounced" : send.status}</b>{send.lastError !== null && send.status !== "sent" && <small> {send.lastError}</small>}</td>
                    <td>{send.sentAt === null ? "-" : ago(send.sentAt)}</td>
                    <td>{send.deliveredAt === null ? "-" : "✓"}</td>
                    <td>{send.openedAt === null ? "-" : "✓"}</td>
                    <td>{send.clickedAt === null ? "-" : "✓"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Writing one ─────────────────────────────────────────────────────────── */

function Editor({ id, onSaved }: { id?: string; onSaved: (id: string) => void }) {
  const { token } = useAuth();
  const [draft, setDraft] = useState<CampaignDraft | null>(id === undefined ? BLANK : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (id === undefined) return;
    void (async () => {
      const found = await consoleCall<CampaignDetail>(`/admin/campaigns/${encodeURIComponent(id)}`, await token());
      if (!found.ok) { setError(found.message); return; }
      const { name, subject, preheader, heading, body, ctaLabel, ctaUrl, audience: who, inactiveDays, totalLimit, dailyLimit } = found.value;
      setDraft({ name, subject, preheader, heading, body, ctaLabel, ctaUrl, audience: who, inactiveDays, totalLimit, dailyLimit });
    })();
  }, [id, token]);

  // How many people each audience reaches right now, for the choice itself.
  const inactive = draft?.inactiveDays ?? null;
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const auth = await token();
        const counts = await Promise.all((["everyone", "subscribed"] as CampaignAudience[]).map(async (who) => {
          const found = await consoleCall<{ count: number }>(`/admin/campaigns/audience?audience=${who}${inactive === null ? "" : `&inactiveDays=${inactive}`}`, auth);
          return [who, found.ok ? found.value.count : null] as const;
        }));
        if (current) setAudience(Object.fromEntries(counts));
      })();
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [inactive, token]);

  if (draft === null) return error !== null ? <div className="notice" data-tone="error" role="alert">{error}</div> : <AdminLoader label="Opening the campaign" shape="detail" />;
  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]): void => setDraft({ ...draft, [key]: value });
  const reach = audience[draft.audience] ?? null;
  const willSend = reach === null ? draft.totalLimit : Math.min(draft.totalLimit, reach);
  const days = Math.ceil(willSend / Math.max(1, draft.dailyLimit));

  const save = async (): Promise<void> => {
    setSaving(true); setError(null);
    const result = await consoleCall<CampaignView>(id === undefined ? "/admin/campaigns" : `/admin/campaigns/${encodeURIComponent(id)}`, await token(), "POST", {
      ...draft, ctaLabel: draft.ctaLabel?.trim() || null, ctaUrl: draft.ctaUrl?.trim() || null,
    });
    setSaving(false);
    if (result.ok) onSaved(result.value.id); else setError(result.message);
  };

  return (
    <div className="adm-editor">
      <form className="adm-editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="adm-panel">
          <legend className="adm-legend">Message</legend>
          <Field label="Name" hint="Only admins see this."><input className="input" required maxLength={120} value={draft.name} onChange={(event) => set("name", event.target.value)} /></Field>
          <Field label="Subject line" hint="Write {{name}} for the first name; people without one get “there”."><input className="input" required maxLength={160} value={draft.subject} onChange={(event) => set("subject", event.target.value)} /></Field>
          <Field label="Preview line" hint="The grey text inboxes show after the subject."><input className="input" maxLength={200} value={draft.preheader} onChange={(event) => set("preheader", event.target.value)} /></Field>
          <Field label="Heading"><input className="input" required maxLength={160} value={draft.heading} onChange={(event) => set("heading", event.target.value)} /></Field>
          <Field label="Message" hint={`Blank lines start a new paragraph. ${number.format(draft.body.length)} of 8,000.`}><textarea className="input" required rows={9} maxLength={8000} value={draft.body} onChange={(event) => set("body", event.target.value)} /></Field>
          <div className="adm-field-row">
            <Field label="Button words"><input className="input" maxLength={60} value={draft.ctaLabel ?? ""} placeholder="Open ADCode" onChange={(event) => set("ctaLabel", event.target.value)} /></Field>
            <Field label="Button link"><input className="input" type="url" maxLength={500} value={draft.ctaUrl ?? ""} placeholder="https://adcode.bluethenics.com/" onChange={(event) => set("ctaUrl", event.target.value)} /></Field>
          </div>
        </fieldset>

        <fieldset className="adm-panel">
          <legend className="adm-legend">Who gets it</legend>
          <div className="adm-choice-grid">
            <Choice checked={draft.audience === "everyone"} onChange={() => set("audience", "everyone")} title="Every verified account" count={audience["everyone"] ?? null}
              text="Anyone who signed in with a verified address. Unsubscribes, bounces and spam complaints are always skipped." />
            <Choice checked={draft.audience === "subscribed"} onChange={() => set("audience", "subscribed")} title="Only people who said yes" count={audience["subscribed"] ?? null}
              text="Accounts that turned on ADCode product updates. Smaller, and the safest for your sender reputation." />
          </div>
          <label className="adm-switch-row">
            <input type="checkbox" checked={draft.inactiveDays !== null} onChange={(event) => set("inactiveDays", event.target.checked ? 14 : null)} />
            <span>Only people who haven&apos;t opened ADCode for</span>
            <input className="input adm-num" type="number" min={1} max={3650} disabled={draft.inactiveDays === null} value={draft.inactiveDays ?? 14}
              onChange={(event) => set("inactiveDays", Math.max(1, Math.min(3650, Number(event.target.value) || 1)))} />
            <span>days</span>
          </label>
        </fieldset>

        <fieldset className="adm-panel">
          <legend className="adm-legend">How many, how fast</legend>
          <div className="adm-field-row">
            <Field label="Total emails" hint="It stops here, or when nobody is left."><input className="input" type="number" min={1} max={100000} required value={draft.totalLimit} onChange={(event) => set("totalLimit", Math.max(1, Math.min(100000, Number(event.target.value) || 1)))} /></Field>
            <Field label="Per day" hint="Spread evenly across the day, not sent at once."><input className="input" type="number" min={1} max={5000} required value={draft.dailyLimit} onChange={(event) => set("dailyLimit", Math.max(1, Math.min(5000, Number(event.target.value) || 1)))} /></Field>
          </div>
          <p className="adm-estimate">
            <strong>{number.format(willSend)} emails</strong> over about <strong>{days} day{days === 1 ? "" : "s"}</strong>
            {reach !== null && reach < draft.totalLimit ? `, because only ${number.format(reach)} people match today` : ""}.
            {draft.dailyLimit > 100 && " Check your Resend plan's daily limit before going above 100 a day."}
          </p>
        </fieldset>

        {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
        <div className="adm-editor-actions">
          <button type="submit" className="btn" disabled={saving}>{saving ? <><LoaderMark size={14} /> Saving</> : id === undefined ? "Save as draft" : "Save changes"}</button>
          <span className="field-hint">Nothing is sent until you press Start sending on the campaign.</span>
        </div>
      </form>

      <aside className="adm-editor-preview">
        <p className="adm-preview-label">Preview</p>
        <EmailPreview draft={draft} />
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="adm-field"><span className="adm-field-label">{label}</span>{children}{hint !== undefined && <span className="adm-field-hint">{hint}</span>}</label>;
}

function Choice({ checked, onChange, title, text, count }: { checked: boolean; onChange: () => void; title: string; text: string; count: number | null }) {
  return (
    <label className="adm-choice" data-checked={checked}>
      <input type="radio" name="audience" checked={checked} onChange={onChange} />
      <strong>{title}</strong>
      <b className="adm-choice-count">{count === null ? <LoaderMark size={14} /> : `${number.format(count)} people`}</b>
      <span>{text}</span>
    </label>
  );
}

/** The email as it will look, built from the same rules as the real template. */
function EmailPreview({ draft }: { draft: Pick<CampaignDraft, "subject" | "preheader" | "heading" | "body" | "ctaLabel" | "ctaUrl"> }) {
  const fill = (text: string): string => text.replace(/\{\{\s*name\s*\}\}/gi, "Maya");
  const blocks = useMemo(() => fill(draft.body).split(/\n\s*\n/).map((block) => block.split("\n")).filter((block) => block.some((line) => line.trim().length > 0)), [draft.body]);
  return (
    <div className="adm-mail">
      <div className="adm-mail-inbox">
        <b>{fill(draft.subject) || "Subject"}</b>
        <span>{fill(draft.preheader)}</span>
      </div>
      <div className="adm-mail-page">
        <p className="adm-mail-brand">adcode<span>.</span></p>
        <div className="adm-mail-card">
          <h3>{fill(draft.heading) || "Heading"}</h3>
          <div className="adm-mail-body">
            {blocks.map((lines, index) => <p key={index}>{lines.map((line, at) => <span key={at}>{at > 0 && <br />}{line}</span>)}</p>)}
            {draft.ctaLabel !== null && draft.ctaLabel.trim().length > 0 && <span className="adm-mail-button">{draft.ctaLabel} →</span>}
          </div>
        </div>
        <p className="adm-mail-foot">You&apos;re receiving this because you have an ADCode account. · Unsubscribe</p>
      </div>
    </div>
  );
}
