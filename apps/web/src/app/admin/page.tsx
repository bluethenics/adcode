"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { money } from "@/components/money";
import { apiFetch, type AdminOverviewView } from "@/lib/api";
import { ReviewQueue } from "./_sections/CreativeQueue";
import { ReportsBody } from "./_sections/Feedback";
import { Withdrawals } from "./_sections/Withdrawals";
import { AdvertisersBody } from "./_sections/Advertisers";
import { PayoutCorridors } from "./_sections/PayoutCorridors";
import { UsersBody } from "./_sections/People";
import { AdminsBody } from "./_sections/Administrators";
import { BlogBody } from "./_sections/Posts";
import { ReleasesBody } from "./_sections/Releases";
import { NoticesBody } from "./_sections/Notices";
import { TestAdsBody } from "./_sections/TestDelivery";

export default function AdminPage() {
  return (
    <AdminShell singlePage title="Admin" subtitle="Every queue and operating control, on one page.">
      <AdminWorkspace />
    </AdminShell>
  );
}

function AdminWorkspace() {
  const { token } = useAuth();
  const [counts, setCounts] = useState<AdminOverviewView | null>(null);

  const load = useCallback(async () => {
    const result = await apiFetch<AdminOverviewView>({ path: "/admin/overview", token: await token() });
    if (result.ok) setCounts(result.value);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="admin-tiles admin-single-metrics">
        <div className="admin-tile" data-waiting={(counts?.creativesWaiting ?? 0) > 0}><strong>{counts?.creativesWaiting ?? "—"}</strong><span>Creatives waiting</span><small>Review before delivery</small></div>
        <div className="admin-tile" data-waiting={(counts?.withdrawalsPending ?? 0) > 0}><strong>{counts?.withdrawalsPending ?? "—"}</strong><span>Payouts waiting</span><small>{money(counts?.pendingWithdrawalMicros ?? "0")} held</small></div>
        <div className="admin-tile" data-waiting={(counts?.reportsOpen ?? 0) > 0}><strong>{counts?.reportsOpen ?? "—"}</strong><span>Reports open</span><small>Needs a response</small></div>
        <div className="admin-tile"><strong>{counts?.advertisers ?? "—"}</strong><span>Advertisers</span><small>Funding the network</small></div>
      </div>

      <AdminBlock id="creative-review" title="Creative review" hint="Approve or reject ads before they reach developers." defaultOpen><ReviewQueue /></AdminBlock>
      <AdminBlock id="withdrawals" title="Manual payouts" hint="Review, approve, send through Wise, and record payment evidence." defaultOpen><Withdrawals initialQuery="" /></AdminBlock>
      <AdminBlock id="feedback" title="Feedback and reports" hint="Questions and issues sent from ADCode."><ReportsBody initialQuery="" /></AdminBlock>
      <AdminBlock id="advertisers" title="Advertisers" hint="Accounts, campaigns, balances, and delivery."><AdvertisersBody initialQuery="" /></AdminBlock>
      <AdminBlock id="corridors" title="Payout countries" hint="Eligible destinations and their required bank fields."><PayoutCorridors /></AdminBlock>
      <AdminBlock id="users" title="Users and earnings" hint="Accounts, balances, activity, and ledger access."><UsersBody initialQuery="" /></AdminBlock>
      <AdminBlock id="administrators" title="Administrators" hint="Who can access these operations."><AdminsBody /></AdminBlock>
      <AdminBlock id="writing" title="Blog and documentation" hint="Public content maintained by the operator."><BlogBody /></AdminBlock>
      <AdminBlock id="releases" title="Releases" hint="Desktop release publishing and notes."><ReleasesBody /></AdminBlock>
      <AdminBlock id="notices" title="Notices" hint="Messages shown inside ADCode."><NoticesBody /></AdminBlock>
      <AdminBlock id="tools" title="Delivery tools" hint="Send safe test cards without moving money."><TestAdsBody /></AdminBlock>
    </>
  );
}

function AdminBlock({ id, title, hint, defaultOpen = false, children }: { id: string; title: string; hint: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details id={id} className="admin-block" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span><strong>{title}</strong><small>{hint}</small></span><i aria-hidden="true">+</i></summary>
      {open && <div className="admin-block-body">{children}</div>}
    </details>
  );
}
