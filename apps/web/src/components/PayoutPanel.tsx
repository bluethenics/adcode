"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { money, moneyExact, when } from "./money";
import { Segmented } from "./ios/Segmented";
import { CURRENCIES, countryName, dollarsToPayoutMicros, microsToDollarsInput } from "@/lib/payoutOptions";
import {
  apiFetch,
  MESSAGES,
  type PayoutCorridorView,
  type PayoutMethod,
  type PayoutsView,
  type WithdrawalView,
} from "@/lib/api";

/**
 * Cashing out.
 *
 * The screen is three questions in the order somebody actually asks them: *can* I be
 * paid, *where* does it go, and *how much* do I want. The first is a checklist rather
 * than a yes/no, because a bare "not eligible" is the message that produces a support
 * email - every rule is shown, passed and failed alike, with the server's own sentence
 * about how far off it is.
 *
 * Nothing here decides eligibility. `GET /v1/payouts` returns the rules, the verdict, the
 * details on file and the history in one read, and the request endpoint re-checks every
 * rule before it moves anything. A browser that lies to itself about being eligible
 * reaches an endpoint that refuses it.
 */
const STATUS_TONE: Record<WithdrawalView["status"], string> = {
  requested: "pending",
  approved: "pending",
  paid: "live",
  rejected: "ended",
  failed: "ended",
  cancelled: "ended",
  returned: "ended",
};

const STATUS_LABEL: Record<WithdrawalView["status"], string> = {
  requested: "In review",
  approved: "Approved for payment",
  paid: "Paid",
  rejected: "Declined",
  failed: "Transfer failed",
  cancelled: "Cancelled",
  returned: "Returned to your balance",
};

export function PayoutPanel() {
  const { token } = useAuth();
  const [view, setView] = useState<PayoutsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<PayoutsView>({ path: "/payouts", token: await token() });
    if (found.ok) setView(found.value);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="skeleton skeleton-card" />;

  if (view === null) {
    return (
      <div className="notice" data-tone="error" role="alert">
        {error ?? MESSAGES["server-error"]}
      </div>
    );
  }

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {saved !== null && (
        <div className="notice" data-tone="ok" role="status">
          {saved}
        </div>
      )}

      <EligibilityCard view={view} />

      <div className="ios-split">
        <DetailsCard
          view={view}
          onSaved={(next, message) => {
            setView(next);
            setSaved(message);
            setError(null);
          }}
          onError={setError}
        />
        <RequestCard
          view={view}
          onDone={(message) => {
            setSaved(message);
            setError(null);
            void load();
          }}
          onError={setError}
        />
      </div>

      <HistoryCard
        view={view}
        onCancelled={() => {
          setSaved("Request cancelled. The money is back in your available balance.");
          void load();
        }}
        onError={setError}
      />
    </>
  );
}

/* ── Can you be paid? ───────────────────────────────────────────────────── */

export function EligibilityCard({ view }: { view: PayoutsView }) {
  const passed = view.rules.filter((rule) => rule.ok).length;

  return (
    <div className="ios-card payout-eligibility" data-eligible={view.eligible}>
      <header className="ios-card-head">
        <h2>{view.eligible ? "You can withdraw" : "Not ready to withdraw yet"}</h2>
        <p>
          {view.eligible ? (
            <>
              Up to <strong className="money">{money(view.availableMicros)}</strong> is available
              to send. Payouts are made by hand, usually within a few working days.
            </>
          ) : (
            <>
              {passed} of {view.rules.length} conditions met. Everything below has to be true
              before we can send money.
            </>
          )}
        </p>
      </header>

      <ul className="checklist">
        {view.rules.map((rule) => (
          <li key={rule.id} data-ok={rule.ok}>
            <span className="checklist-mark" aria-hidden="true">
              {rule.ok ? "✓" : "○"}
            </span>
            <span>
              <strong>{rule.label}</strong>
              <small>{rule.detail}</small>
            </span>
            <span className="sr-only">{rule.ok ? "Met" : "Not met"}</span>
          </li>
        ))}
      </ul>

      {view.pendingMicros !== "0" && (
        <p className="field-hint" style={{ marginTop: 14 }}>
          <strong className="money">{money(view.pendingMicros)}</strong> is held against a
          request under review. It leaves your available balance until that request is settled.
        </p>
      )}
    </div>
  );
}

/* ── Where does it go? ──────────────────────────────────────────────────── */

const FIELD_LABELS: Record<string, string> = {
  iban: "IBAN", bic: "BIC / SWIFT", accountNumber: "Account number",
  routingNumber: "Routing number", sortCode: "Sort code", ifsc: "IFSC code",
  bsb: "BSB", bankCode: "Bank code", branchCode: "Branch code", clabe: "CLABE",
  bankName: "Bank name", address: "Recipient address", email: "Recipient email",
  phone: "Recipient phone", supplemental: "Additional recipient details",
};

/**
 * Where the money goes.
 *
 * Two ways to answer, and the order matters: a Wise address is offered first because it is
 * one field instead of four, and somebody who already has Wise should not have to find
 * their IBAN to be paid. Bank details are for everyone else, and only for the country and
 * currency combinations an administrator has enabled — Wise resolves an email recipient
 * itself, so that route has no such restriction and works anywhere.
 */
function DetailsCard({ view, onSaved, onError }: {
  view: PayoutsView;
  onSaved: (next: PayoutsView, message: string) => void;
  onError: (message: string) => void;
}) {
  const { token } = useAuth();
  const profile = view.profile;
  const [method, setMethod] = useState<PayoutMethod>(profile?.method ?? "wise-email");
  const [corridors, setCorridors] = useState<PayoutCorridorView[]>([]);
  const [selected, setSelected] = useState(profile === null ? "" : `${profile.country}:${profile.currency}`);
  const [legalName, setLegalName] = useState(profile?.legalName ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [currency, setCurrency] = useState(profile?.currency ?? "USD");
  const [fields, setFields] = useState<Record<string, string>>(profile?.fields ?? {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await apiFetch<{ corridors: PayoutCorridorView[] }>({ path: "/payout-corridors", token: await token() });
      if (!result.ok) { onError(MESSAGES[result.error]); return; }
      setCorridors(result.value.corridors);
      const first = result.value.corridors[0];
      if (selected === "" && first !== undefined) setSelected(`${first.country}:${first.currency}`);
    })();
  }, [onError, selected, token]);

  const corridor = corridors.find((item) => `${item.country}:${item.currency}` === selected);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);

    const body = method === "wise-email"
      ? { method, legalName, country: profile?.country ?? "US", currency, email: email.trim(), bankDetails: null, fields: {} }
      : corridor === undefined
        ? null
        : {
            method, legalName, country: corridor.country, currency: corridor.currency,
            email: null, bankDetails: null,
            fields: Object.fromEntries(corridor.requiredFields.map((kind) => [kind, fields[kind]?.trim() ?? ""])),
          };

    if (body === null) { setBusy(false); return; }

    const result = await apiFetch<PayoutsView>({
      path: "/payouts/profile", token: await token(), method: "POST", body,
    });
    setBusy(false);
    if (result.ok) {
      onSaved(
        result.value,
        method === "wise-email" ? "Wise address saved." : "Encrypted bank details saved.",
      );
    } else onError(MESSAGES[result.error]);
  };

  return <form className="ios-card" onSubmit={(event) => void save(event)}>
    <header className="ios-card-head">
      <h2>Payout details</h2>
      <p>Transfers are made by hand through Wise, so the name here has to match the receiving account exactly — a mismatch is what makes a transfer bounce. Everything you enter is encrypted at rest.</p>
    </header>

    <div className="field">
      <label htmlFor="payout-method">How to pay you</label>
      <Segmented
        label="Payout method"
        value={method}
        onChange={setMethod}
        options={[
          { value: "wise-email" as const, label: "Wise account" },
          { value: "bank" as const, label: "Bank account" },
        ]}
      />
      <p className="field-hint" id="payout-method">
        {method === "wise-email"
          ? "We send to the email address on your Wise account. One field, and it works from anywhere."
          : "We add you as a recipient in Wise and send to your bank. Use this if you don't have Wise."}
      </p>
    </div>

    <div className="field">
      <label htmlFor="legal-name">Full legal name on the account</label>
      <input id="legal-name" className="input" value={legalName} maxLength={120} required autoComplete="name" onChange={(event) => setLegalName(event.target.value)} />
    </div>

    {method === "wise-email" ? <>
      <div className="field">
        <label htmlFor="payout-email">Email on your Wise account</label>
        <input id="payout-email" className="input" type="email" value={email} maxLength={320} required autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="payout-currency">Currency to receive</label>
        <select id="payout-currency" className="select" value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <p className="field-hint">Balances are held in USD. Wise converts at the rate on the day it sends.</p>
      </div>
    </> : corridors.length === 0 ? (
      <div className="notice" data-tone="warning">No bank destination is enabled yet. Choose Wise account above, or ask an administrator to enable your country.</div>
    ) : <>
      <div className="field">
        <label htmlFor="payout-route">Destination country and currency</label>
        <select id="payout-route" className="select" value={selected} onChange={(event) => { setSelected(event.target.value); setFields({}); }}>
          {corridors.map((item) => <option key={`${item.country}:${item.currency}`} value={`${item.country}:${item.currency}`}>{countryName(item.country)} · {item.currency}</option>)}
        </select>
      </div>
      {corridor?.requiredFields.map((kind) => <div className="field" key={kind}>
        <label htmlFor={`payout-${kind}`}>{FIELD_LABELS[kind] ?? kind}</label>
        <input id={`payout-${kind}`} className="input" value={fields[kind] ?? ""} required autoComplete="off" onChange={(event) => setFields((current) => ({ ...current, [kind]: event.target.value }))} />
      </div>)}
      <p className="field-hint">Spacing and capitalisation don&apos;t matter — an IBAN copied straight off a statement is fine.</p>
    </>}

    <p className="field-hint">An administrator reviews and approves the request, sends it manually, then records the transfer reference.</p>
    <div className="actions">
      <button className="btn btn-primary btn-small" disabled={busy} type="submit">
        {busy ? "Saving…" : profile === null ? "Save payout details" : "Update payout details"}
      </button>
      {profile !== null && <span className="field-hint" style={{ alignSelf: "center" }}>Last changed {when(profile.updatedAt)}</span>}
    </div>
  </form>;
}

/* ── How much? ─────────────────────────────────────────────────────────── */

function RequestCard({
  view,
  onDone,
  onError,
}: {
  view: PayoutsView;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { token } = useAuth();
  const [amount, setAmount] = useState(() => microsToDollarsInput(view.availableMicros));
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();

    const micros = dollarsToPayoutMicros(amount);
    if (micros === null) {
      onError("Enter an amount in dollars and cents, like 12.50.");
      return;
    }

    setBusy(true);
    const result = await apiFetch<WithdrawalView>({
      path: "/withdrawals",
      token: await token(),
      method: "POST",
      body: { amountMicros: micros },
    });

    setBusy(false);
    if (result.ok) onDone("Request received. We'll email you when it's been sent.");
    else onError(MESSAGES[result.error]);
  };

  return (
    <form className="ios-card" onSubmit={(event) => void submit(event)}>
      <header className="ios-card-head">
        <h2>Request a payout</h2>
        <p>
          The minimum is <strong className="money">{money(view.minMicros)}</strong>. The amount
          leaves your available balance straight away and is held until we send it.
        </p>
      </header>

      <div className="field">
        <label htmlFor="payout-amount">Amount in USD</label>
        <input
          id="payout-amount"
          className="input"
          inputMode="decimal"
          value={amount}
          disabled={!view.eligible}
          onChange={(event) => setAmount(event.target.value)}
        />
        <p className="field-hint">
          You have {moneyExact(view.availableMicros)} available.{" "}
          <button
            type="button"
            className="link-button"
            disabled={!view.eligible}
            onClick={() => setAmount(microsToDollarsInput(view.availableMicros))}
          >
            Withdraw all of it
          </button>
        </p>
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-small" type="submit" disabled={busy || !view.eligible}>
          {busy ? "Sending…" : "Request payout"}
        </button>
      </div>

      {!view.eligible && (
        <p className="field-hint">
          The checklist above has to be complete before this can be sent.
        </p>
      )}
    </form>
  );
}

/* ── What happened to the last ones ─────────────────────────────────────── */

function HistoryCard({
  view,
  onCancelled,
  onError,
}: {
  view: PayoutsView;
  onCancelled: () => void;
  onError: (message: string) => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const cancel = async (withdrawalId: string): Promise<void> => {
    setBusy(withdrawalId);
    const result = await apiFetch<WithdrawalView>({
      path: `/withdrawals/${encodeURIComponent(withdrawalId)}/cancel`,
      token: await token(),
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (result.ok) onCancelled();
    else onError(MESSAGES[result.error]);
  };

  return (
    <div className="ios-card">
      <header className="ios-card-head">
        <h2>Your requests</h2>
        <p>Every payout you have asked for, and what happened to it.</p>
      </header>

      {view.withdrawals.length === 0 ? (
        <div className="empty">
          <h3>Nothing requested yet</h3>
          <p>When you ask for a payout it appears here with its status until it is sent.</p>
        </div>
      ) : (
        <ul className="ios-group ios-group-plain">
          {view.withdrawals.map((row) => (
            <li key={row.withdrawalId}>
              <div className="ios-row">
                <div style={{ minWidth: 0 }}>
                  <strong className="money">{money(row.amountMicros)}</strong>
                  <small>
                    {when(row.createdAt)}
                    {row.providerRef !== null && (
                      <>
                        {" · "}
                        <span className="mono">{row.providerRef}</span>
                      </>
                    )}
                    {row.note !== null && <> · {row.note}</>}
                  </small>
                </div>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="pill" data-tone={STATUS_TONE[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.status === "requested" && (
                    <button
                      className="btn btn-outline btn-small"
                      disabled={busy === row.withdrawalId}
                      onClick={() => void cancel(row.withdrawalId)}
                    >
                      Cancel
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
