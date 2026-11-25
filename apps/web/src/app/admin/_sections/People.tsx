"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/components/AuthProvider";
import { AdminLoader, LoaderMark } from "@/components/AdminLoader";
import { LedgerRows } from "@/components/LedgerRows";
import { apiFetch, MESSAGES, type LedgerPageView, type LedgerRowView } from "@/lib/api";
import { consoleCall, type UserHit, type UserProfile } from "@/lib/adminConsoleClient";

/**
 * Users: find anyone, then act on their account.
 *
 * The search used to filter the newest 200 accounts in the browser, so somebody who wrote in
 * from an address that signed up last month could not be found. It now asks the server, across
 * every account, by uid (exact or the first few characters), by email (all or part of it - a
 * Gmail address, or just "gmail.com") or by name. With an empty box the page shows the newest
 * sign-ups, which is what somebody opening Users without a question usually wants.
 *
 * Choosing a person opens their account beside the list: who they are, whether they are using
 * ADCode, what they pay, what email they get, and every action an administrator can take, each
 * one audited. The open account is in the URL (`?uid=`), so it can be linked to.
 */

const number = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const micros = (value: string | null | undefined): string => {
  if (value === null || value === undefined) return "$0.00";
  try { return usd.format(Number(BigInt(value)) / 1_000_000); } catch { return "$0.00"; }
};
const PLAN_NAMES: Record<string, string> = { weekly: "Weekly", monthly: "Builder", pro: "Pro", max: "Max", unlimited: "Unlimited" };

export function ago(at: number | null | undefined): string {
  if (at === null || at === undefined || at <= 0) return "never";
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 45) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const date = (at: number | null | undefined): string => (at === null || at === undefined ? "-" : new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));

interface RecentRow { uid: string; status: string; createdAt: number; email?: string; displayName?: string; photoUrl?: string }

export function UsersBody({ initialQuery = "" }: { initialQuery?: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<UserHit[] | null>(null);
  const [recent, setRecent] = useState<UserHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openUid = params.get("uid");
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback((uid: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (uid === null) next.delete("uid"); else next.set("uid", uid);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // The newest sign-ups, for an empty box.
  useEffect(() => {
    void (async () => {
      const found = await apiFetch<{ rows: RecentRow[] }>({ path: "/admin/users?limit=40", token: await token() });
      if (found.ok) setRecent(found.value.rows.map((row) => ({ uid: row.uid, email: row.email ?? null, displayName: row.displayName ?? null, photoUrl: row.photoUrl ?? null, status: row.status, emailVerified: null, createdAt: row.createdAt, lastActiveAt: null })));
      else setRecent([]);
    })();
  }, [token]);

  // Ask the server a quarter second after typing stops; the newest answer wins.
  const asked = useRef(0);
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) { setHits(null); setSearching(false); setError(null); return; }
    setSearching(true);
    const ticket = ++asked.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const found = await consoleCall<{ rows: UserHit[] }>(`/admin/console/users?q=${encodeURIComponent(needle)}`, await token());
        if (ticket !== asked.current) return;
        setSearching(false);
        if (!found.ok) { setError(found.message); setHits([]); return; }
        setError(null);
        setHits(found.value.rows);
        // A pasted uid or a full address that matches exactly one account opens it.
        const only = found.value.rows.length === 1 ? found.value.rows[0] : undefined;
        if (only !== undefined && (only.uid === needle || only.email?.toLowerCase() === needle.toLowerCase())) open(only.uid);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
    // `open` changes with the URL; re-running the search on every open would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, token]);

  const searchingNow = query.trim().length >= 2;
  const list = searchingNow ? hits : recent;

  return (
    <div className="adm-people" data-open={openUid !== null}>
      <div className="adm-people-list">
        <div className="adm-finder">
          <svg className="adm-finder-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input
            ref={inputRef}
            className="adm-finder-input"
            type="search"
            autoFocus
            placeholder="Search by UID, Gmail or name"
            aria-label="Search accounts by uid, email or name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && <span className="adm-finder-busy"><LoaderMark size={16} /></span>}
        </div>
        <p className="adm-finder-hint">
          {searchingNow
            ? hits === null ? "Searching every account…" : `${number.format(hits.length)}${hits.length === 25 ? "+" : ""} match${hits.length === 1 ? "" : "es"} across every account`
            : "Paste a uid or an address, or type part of one. Showing the newest sign-ups."}
        </p>

        {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}

        {list === null ? (
          <AdminLoader label={searchingNow ? "Searching" : "Loading accounts"} rows={6} />
        ) : list.length === 0 ? (
          <div className="adm-empty-state">
            <strong>{searchingNow ? "Nobody matches that" : "No accounts yet"}</strong>
            <p>{searchingNow ? "Try the first characters of the uid, the whole address, or just the part before the @." : "Accounts appear the first time someone opens ADCode."}</p>
          </div>
        ) : (
          <ul className="adm-people-rows">
            {list.map((row, index) => (
              <li key={row.uid} style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}>
                <button type="button" className="adm-person" aria-current={openUid === row.uid ? "true" : undefined} onClick={() => open(row.uid)}>
                  <Avatar photoUrl={row.photoUrl ?? null} label={row.displayName ?? row.email ?? row.uid} />
                  <span className="adm-person-main">
                    <strong>{row.displayName ?? row.email ?? "Anonymous account"}</strong>
                    <span>{row.displayName !== null && row.email !== null ? row.email : <code>{row.uid}</code>}</span>
                  </span>
                  <span className="adm-person-meta">
                    {row.status === "banned" && <b className="adm-chip" data-tone="bad">Banned</b>}
                    <span>{row.lastActiveAt !== null ? `active ${ago(row.lastActiveAt)}` : `joined ${ago(row.createdAt)}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openUid !== null && <UserPanel key={openUid} uid={openUid} onClose={() => open(null)} />}
    </div>
  );
}

/* ── One account ─────────────────────────────────────────────────────────── */

function UserPanel({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await consoleCall<UserProfile>(`/admin/console/users/${encodeURIComponent(uid)}`, await token());
    if (found.ok) { setProfile(found.value); setError(null); } else setError(found.message);
  }, [token, uid]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = (message: string): void => { setNotice(message); void load(); window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 4000); };

  return (
    <aside className="adm-account" aria-label="Account">
      <div className="adm-account-bar">
        <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close the account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <span>Account</span>
      </div>
      {error !== null ? (
        <div className="notice" data-tone="error" role="alert">{error}</div>
      ) : profile === null ? (
        <AdminLoader label="Opening the account" shape="detail" />
      ) : (
        <div className="adm-account-body">
          <header className="adm-account-head">
            <Avatar photoUrl={profile.photoUrl ?? null} label={profile.displayName ?? profile.email ?? profile.uid} />
            <div>
              <h2>{profile.displayName ?? profile.email ?? "Anonymous account"}</h2>
              {profile.email !== null && <p><a href={`mailto:${profile.email}`}>{profile.email}</a></p>}
              <CopyLine value={profile.uid} />
              <div className="adm-chips">
                <b className="adm-chip" data-tone={profile.status === "banned" ? "bad" : "ok"}>{profile.status === "banned" ? "Banned" : "Active"}</b>
                {profile.isAdmin && <b className="adm-chip" data-tone="info">Administrator</b>}
                {profile.email !== null && <b className="adm-chip" data-tone={profile.emailVerified ? "ok" : "warn"}>{profile.emailVerified ? "Email verified" : "Email not verified"}</b>}
                {profile.aiBlocked && <b className="adm-chip" data-tone="bad">AI blocked</b>}
              </div>
            </div>
          </header>

          {notice !== null && <div className="notice" data-tone="success" role="status">{notice}</div>}
          {profile.status === "banned" && (
            <div className="notice" data-tone="error" role="status">
              <p><b>Banned.</b> Every ADCode request from this account is refused: AI, paid models, sponsored-card earning, converting and withdrawing, invites and reports. The desktop app, the web version and the website show it a banned screen that points to {"adcode.support@gmail.com"}. Its balance, credits and projects are kept; unbanning restores them within seconds.</p>
            </div>
          )}

          <dl className="adm-facts-grid">
            <Fact label="Last active" value={ago(profile.activity?.lastActiveAt)} hint={`Joined ${date(profile.createdAt)}`} />
            <Fact label="Days active, 30 d" value={number.format(profile.activity?.daysActive30 ?? 0)} hint={`${number.format(profile.activity?.activeMinutes30 ?? 0)} min in the editor`} />
            <Fact label="AI requests, 30 d" value={number.format(profile.ai?.requests30 ?? 0)} hint={`${micros(profile.ai?.costMicros30)} provider cost`} />
            <Fact label="Plan" value={planLine(profile)} hint={planHint(profile)} />
            <Fact label="Credits" value={micros(profile.wallet?.balanceMicros)} hint={profile.wallet !== null && profile.wallet.reservedMicros !== "0" ? `${micros(profile.wallet.reservedMicros)} reserved` : "USD model credits"} />
            <Fact label="Earnings" value={micros(profile.earnings?.availableMicros)} hint={`${micros(profile.earnings?.lifetimeMicros)} all time`} />
          </dl>

          <Actions profile={profile} onDone={done} />

          <section className="adm-account-section">
            <h3>Email</h3>
            <ul className="adm-kv">
              <li><span>Product updates</span><b>{profile.mail.productUpdates ? "Said yes" : "No"}</b></li>
              <li><span>Status and model emails</span><b>{[profile.mail.statusUpdates && "status", profile.mail.modelUpdates && "models"].filter(Boolean).join(", ") || "No"}</b></li>
              <li><span>Blocked</span><b>{profile.mail.suppressed === null ? "No" : `${profile.mail.suppressed.reason === "unsubscribe" ? "Unsubscribed" : profile.mail.suppressed.reason === "bounce" ? "Bounced" : "Marked as spam"}, ${date(profile.mail.suppressed.at)}`}</b></li>
            </ul>
            {profile.mail.campaigns.length > 0 && (
              <ul className="adm-timeline">
                {profile.mail.campaigns.map((sent, index) => (
                  <li key={index}><b>{sent.campaign}</b><span>{sent.status === "sent" ? `sent ${ago(sent.sentAt)}${sent.clickedAt !== null ? " · clicked" : sent.openedAt !== null ? " · opened" : ""}` : sent.status}</span></li>
                ))}
              </ul>
            )}
          </section>

          {(profile.invitedBy !== null || profile.invited > 0) && (
            <section className="adm-account-section">
              <h3>Invites</h3>
              <ul className="adm-kv">
                {profile.invitedBy !== null && <li><span>Invited by</span><b>{profile.invitedBy.referrerUid ?? `campaign ${profile.invitedBy.code}`}</b></li>}
                <li><span>Has invited</span><b>{number.format(profile.invited)}</b></li>
              </ul>
            </section>
          )}

          <Ledger uid={profile.uid} />

          {profile.audit.length > 0 && (
            <section className="adm-account-section">
              <h3>Admin history</h3>
              <ul className="adm-timeline">
                {profile.audit.map((entry, index) => <li key={index}><b>{entry.action.replace(/[-:]/g, " ")}</b><span>{ago(entry.at)}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

function planLine(profile: UserProfile): string {
  const live = profile.subscription !== null && ["active", "trialing", "on_hold"].includes(profile.subscription.status);
  if (live) return PLAN_NAMES[profile.subscription!.plan] ?? profile.subscription!.plan;
  if (profile.gift !== null) return `${PLAN_NAMES[profile.gift.plan] ?? profile.gift.plan} (gift)`;
  return "Free";
}
function planHint(profile: UserProfile): string {
  if (profile.subscription !== null && ["active", "trialing", "on_hold"].includes(profile.subscription.status)) {
    const end = profile.subscription.periodEnd ?? profile.subscription.endsAt;
    return profile.subscription.cancelAtPeriodEnd ? `Ends ${date(end)}` : `Renews ${date(end)}`;
  }
  if (profile.gift !== null) return `Until ${date(profile.gift.endsAt)}`;
  return profile.subscription === null ? "Never subscribed" : `Last plan ${profile.subscription.status}`;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="adm-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint !== undefined && <p>{hint}</p>}
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="adm-copy" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }); }} title="Copy the uid">
      <code>{value}</code><span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

type Busy = null | "ban" | "ai" | "email" | "reset" | "gift";

function Actions({ profile, onDone }: { profile: UserProfile; onDone: (message: string) => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [gift, setGift] = useState({ plan: "pro", days: 30, note: "" });
  const [giftOpen, setGiftOpen] = useState(false);

  const run = async (what: Exclude<Busy, null>, call: () => Promise<{ ok: true } | { ok: false; message: string }>, message: string): Promise<void> => {
    setBusy(what); setError(null); setConfirm(null);
    const result = await call();
    setBusy(null);
    if (result.ok) onDone(message); else setError(result.message);
  };
  const plain = async (path: string, body: unknown): Promise<{ ok: true } | { ok: false; message: string }> => {
    const result = await consoleCall<unknown>(path, await token(), "POST", body);
    return result.ok ? { ok: true } : result;
  };
  const banned = profile.status === "banned";
  const emailBlocked = profile.mail.suppressed !== null;
  const providerBlocked = profile.mail.suppressed !== null && profile.mail.suppressed.reason !== "unsubscribe";

  /** A destructive action asks once more, in place, instead of in a dialog. */
  const twice = (what: Exclude<Busy, null>, action: () => void): (() => void) => () => { if (confirm === what) action(); else setConfirm(what); };

  return (
    <section className="adm-account-section">
      <h3>Actions</h3>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      <div className="adm-actions">
        <ActionButton
          label={banned ? "Unban" : confirm === "ban" ? "Confirm ban" : "Ban account"}
          hint={banned ? "Gives the account back within seconds, everywhere" : "Within seconds: every request refused, a banned screen everywhere"}
          tone={banned ? undefined : "bad"} busy={busy === "ban"} armed={confirm === "ban"}
          onClick={banned
            ? () => void run("ban", () => plain(`/admin/users/${encodeURIComponent(profile.uid)}/status`, { status: "active" }), "Account unbanned.")
            : twice("ban", () => void run("ban", () => plain(`/admin/users/${encodeURIComponent(profile.uid)}/status`, { status: "banned" }), "Account banned."))}
        />
        <ActionButton
          label={profile.aiBlocked ? "Allow AI" : confirm === "ai" ? "Confirm block" : "Block AI"}
          hint={profile.aiBlocked ? "Included and paid models work again" : "Stops included and paid models for them"}
          tone={profile.aiBlocked ? undefined : "bad"} busy={busy === "ai"} armed={confirm === "ai"}
          onClick={(profile.aiBlocked ? (fn: () => void) => fn : (fn: () => void) => twice("ai", fn))(() => void run("ai", async () => {
            const auth = await token();
            const current = await consoleCall<{ policy: { limits?: unknown; credits?: unknown } | null }>(`/admin/tagflow/users/${encodeURIComponent(profile.uid)}`, auth);
            if (!current.ok) return current;
            const policy = current.value.policy;
            return plain(`/admin/tagflow/users/${encodeURIComponent(profile.uid)}`, { blocked: !profile.aiBlocked, limits: policy?.limits ?? null, credits: policy?.credits ?? null });
          }, profile.aiBlocked ? "AI allowed again." : "AI blocked for this account."))}
        />
        <ActionButton
          label="Reset AI week"
          hint="Clears this week's used allowance"
          busy={busy === "reset"}
          onClick={() => void run("reset", () => plain("/admin/ai-plans/reset", { uid: profile.uid }), "This week's AI allowance was reset.")}
        />
        <ActionButton
          label={emailBlocked ? "Allow email" : "Stop email"}
          hint={providerBlocked ? "Bounced or spam: can't be undone" : emailBlocked ? "Lets campaigns reach them again" : "No campaigns or updates to them"}
          disabled={providerBlocked || profile.email === null}
          busy={busy === "email"}
          onClick={() => void run("email", () => plain(`/admin/console/users/${encodeURIComponent(profile.uid)}/email`, { blocked: !emailBlocked }), emailBlocked ? "Email allowed again." : "Email stopped for this address.")}
        />
        <ActionButton label="Gift a plan" hint="Free Builder, Pro or Max for some days" busy={busy === "gift"} armed={giftOpen} onClick={() => setGiftOpen((was) => !was)} />
      </div>

      {giftOpen && (
        <form className="adm-inline-form" onSubmit={(event) => {
          event.preventDefault();
          void run("gift", () => plain("/admin/ai-plans/gift", { uid: profile.uid, plan: gift.plan, days: gift.days, note: gift.note }), `${PLAN_NAMES[gift.plan]} gifted for ${gift.days} days.`).then(() => setGiftOpen(false));
        }}>
          <label><span>Plan</span>
            <select className="input" value={gift.plan} onChange={(event) => setGift({ ...gift, plan: event.target.value })}>
              <option value="monthly">Builder</option><option value="pro">Pro</option><option value="max">Max</option>
            </select>
          </label>
          <label><span>Days</span><input className="input" type="number" min={1} max={366} value={gift.days} onChange={(event) => setGift({ ...gift, days: Math.max(1, Math.min(366, Number(event.target.value) || 1)) })} /></label>
          <label className="adm-inline-wide"><span>Note (only admins see it)</span><input className="input" maxLength={500} value={gift.note} placeholder="Why, for the audit log" onChange={(event) => setGift({ ...gift, note: event.target.value })} /></label>
          <button type="submit" className="btn btn-small" disabled={busy === "gift"}>{busy === "gift" ? "Gifting…" : "Gift plan"}</button>
        </form>
      )}
    </section>
  );
}

function ActionButton({ label, hint, onClick, busy, tone, armed = false, disabled = false }: { label: string; hint: string; onClick: () => void; busy: boolean; tone?: "bad" | undefined; armed?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className="adm-action" data-tone={tone} data-armed={armed} disabled={busy || disabled} onClick={onClick}>
      <strong>{busy ? <><LoaderMark size={14} /> Working</> : label}</strong>
      <span>{hint}</span>
    </button>
  );
}

/* ── Ledger ──────────────────────────────────────────────────────────────── */

function Ledger({ uid }: { uid: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<LedgerRowView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || rows !== null) return;
    void (async () => {
      const found = await apiFetch<LedgerPageView>({ path: `/admin/users/${encodeURIComponent(uid)}/ledger?limit=25`, token: await token() });
      if (found.ok) setRows(found.value.rows); else { setError(MESSAGES[found.error]); setRows([]); }
    })();
  }, [open, rows, token, uid]);
  return (
    <section className="adm-account-section">
      <button type="button" className="adm-disclosure" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <h3>Earnings ledger</h3><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (rows === null ? <AdminLoader label="Reading the ledger" rows={3} /> : error !== null ? <p className="field-hint">{error}</p> : rows.length === 0 ? <p className="field-hint">No entries on this account. Opening it is recorded.</p> : <LedgerRows rows={rows} />)}
    </section>
  );
}
