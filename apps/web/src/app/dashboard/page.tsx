"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type BalanceView, type LedgerPageView, type LedgerRowView } from "@/lib/api";
import { LedgerRows } from "@/components/LedgerRows";
import { money, moneyExact } from "@/components/money";

export default function Dashboard() {
  return (
    <AppShell title="Your earnings">
      <DashboardBody />
    </AppShell>
  );
}

function DashboardBody() {
  const { token } = useAuth();

  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [rows, setRows] = useState<LedgerRowView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await token();

    const bal = await apiFetch<BalanceView>({ path: "/balance", token: t });
    if (!bal.ok) {
      setError(MESSAGES[bal.error]);
      setLoading(false);
      return;
    }
    setBalance(bal.value);

    const page = await apiFetch<LedgerPageView>({ path: "/ledger?limit=25", token: t });
    if (page.ok) {
      setRows(page.value.rows);
      setCursor(page.value.nextCursor);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (cursor === null || more) return;
    setMore(true);

    const page = await apiFetch<LedgerPageView>({
      path: `/ledger?limit=25&cursor=${encodeURIComponent(cursor)}`,
      token: await token(),
    });

    setMore(false);
    if (!page.ok) {
      setError(MESSAGES[page.error]);
      return;
    }
    setRows((current) => [...current, ...page.value.rows]);
    setCursor(page.value.nextCursor);
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Available</span>
          <span className="stat-value money">{moneyExact(balance?.availableMicros ?? "0")}</span>
          <span className="stat-hint">Yours to withdraw, once withdrawals open</span>
        </div>
        <div className="stat">
          <span className="stat-label">Earned all time</span>
          <span className="stat-value">{moneyExact(balance?.lifetimeMicros ?? "0")}</span>
          <span className="stat-hint">After any reversals</span>
        </div>
        <div className="stat">
          <span className="stat-label">Entries</span>
          <span className="stat-value">{rows.length}{cursor === null ? "" : "+"}</span>
          <span className="stat-hint">Every credit and correction</span>
        </div>
      </div>

      <div className="notice" data-tone="info">
        Withdrawals aren&apos;t open yet. Your balance keeps accruing and every entry stays
        on this ledger — we&apos;ll say here when cash-out is available.
      </div>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Every entry</h3>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>
            Open ADCode and keep working. When a sponsored card appears and you see it,
            a row lands here with the exact amount.
          </p>
        </div>
      ) : (
        <>
          <LedgerRows rows={rows} />
          {cursor !== null && (
            <div className="actions">
              <button className="btn btn-outline btn-small" disabled={more} onClick={() => void loadMore()}>
                Load older entries
              </button>
            </div>
          )}
        </>
      )}

      <p className="field-hint" style={{ marginTop: 22, maxWidth: "64ch" }}>
        This ledger is append-only. Nothing is ever edited or deleted — if a credit has to
        be taken back, a separate reversal row appears and both stay visible. What you see
        here is exactly what we see.
      </p>
    </>
  );
}
