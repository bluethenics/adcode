"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { Withdrawals } from "../_sections/Withdrawals";
import { AdvertisersBody } from "../_sections/Advertisers";
import { PayoutCorridors } from "../_sections/PayoutCorridors";

const TABS = [
  { id: "payouts", label: "Payouts" },
  { id: "advertisers", label: "Advertisers" },
  { id: "countries", label: "Countries" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const HEADS: Record<TabId, { title: string; subtitle: string }> = {
  payouts: {
    title: "Payouts",
    subtitle: "Review the request, send it through Wise, record the evidence.",
  },
  advertisers: {
    title: "Advertisers",
    subtitle: "Accounts, campaigns, balances, and delivery.",
  },
  countries: {
    title: "Payout countries",
    subtitle: "Eligible destinations and the bank fields each one needs.",
  },
};

function MoneyBody() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("tab") ?? "payouts";
  // The invite terms used to be a Money tab no sidebar row pointed to; they live in Growth now.
  useEffect(() => {
    if (requested === "invites") router.replace("/admin/growth?tab=terms");
  }, [requested, router]);
  const tab: TabId = TABS.some((candidate) => candidate.id === requested)
    ? (requested as TabId)
    : "payouts";
  const q = params.get("q") ?? "";

  return (
    <AdminShell title={HEADS[tab].title} subtitle={HEADS[tab].subtitle} tab={tab}>
      <AdminTabs base="/admin/money" active={tab} tabs={[...TABS]} />
      {/* `key` re-reads a fresh jump-box query rather than keeping a stale search. */}
      {tab === "payouts" && <Withdrawals key={q} initialQuery={q} />}
      {tab === "advertisers" && <AdvertisersBody key={q} initialQuery={q} />}
      {tab === "countries" && <PayoutCorridors />}
    </AdminShell>
  );
}

export default function MoneyPage() {
  return (
    <Suspense fallback={null}>
      <MoneyBody />
    </Suspense>
  );
}
