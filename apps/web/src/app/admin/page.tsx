"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { money } from "@/components/money";
import { apiFetch, type AdminOverviewView } from "@/lib/api";

/**
 * The front desk: every queue's count, each one a link to where the work happens.
 *
 * This page used to be the whole panel - eleven disclosures stacked on one URL. It is
 * deliberately spare now: the rail beside it is the panel, and this screen only answers
 * "is anything waiting, and where do I go".
 */
export default function AdminPage() {
  return (
    <AdminShell title="Overview" subtitle="What needs a decision, and how many of them.">
      <Overview />
    </AdminShell>
  );
}

function Overview() {
  const { token } = useAuth();
  const [counts, setCounts] = useState<AdminOverviewView | null>(null);

  const load = useCallback(async () => {
    const result = await apiFetch<AdminOverviewView>({ path: "/admin/overview", token: await token() });
    if (result.ok) setCounts(result.value);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="admin-tiles">
        <Link className="admin-tile" href="/admin/review" data-waiting={(counts?.creativesWaiting ?? 0) > 0}>
          <strong>{counts?.creativesWaiting ?? "—"}</strong>
          <span>Creatives waiting</span>
          <small>Review before delivery</small>
        </Link>
        <Link className="admin-tile" href="/admin/money" data-waiting={(counts?.withdrawalsPending ?? 0) > 0}>
          <strong>{counts?.withdrawalsPending ?? "—"}</strong>
          <span>Payouts waiting</span>
          <small>{money(counts?.pendingWithdrawalMicros ?? "0")} held</small>
        </Link>
        <Link className="admin-tile" href="/admin/review?tab=feedback" data-waiting={(counts?.reportsOpen ?? 0) > 0}>
          <strong>{counts?.reportsOpen ?? "—"}</strong>
          <span>Reports open</span>
          <small>Needs a response</small>
        </Link>
        <Link className="admin-tile" href="/admin/content?tab=notices" data-waiting={false}>
          <strong>{counts?.noticesActive ?? "—"}</strong>
          <span>Notices live</span>
          <small>Shown inside ADCode</small>
        </Link>
      </div>

      <div className="admin-tiles admin-tiles-quiet">
        <Link className="admin-tile" href="/admin/money?tab=advertisers">
          <strong>{counts?.advertisers ?? "—"}</strong>
          <span>Advertisers</span>
          <small>Funding the network</small>
        </Link>
      </div>

      <p className="field-hint" style={{ maxWidth: "64ch" }}>
        Pick a destination from the rail, or paste an id into the jump box - every
        identifier in the system routes itself to the screen that shows it.
      </p>
    </>
  );
}
