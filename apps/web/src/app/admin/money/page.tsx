"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { Withdrawals } from "../_sections/Withdrawals";
import { AdvertisersBody } from "../_sections/Advertisers";
import { PayoutCorridors } from "../_sections/PayoutCorridors";
import { ReferralSettings } from "../_sections/ReferralSettings";

const TABS = [
  { id: "payouts", label: "Payouts" },
  { id: "advertisers", label: "Advertisers" },
  { id: "countries", label: "Countries" },
  { id: "invites", label: "Invites" },
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
  invites: {
    title: "Invites",
    subtitle: "The invite programme's terms, ADCode's own advertisers, and settling a day by hand.",
  },
};

function MoneyBody() {
  const params = useSearchParams();
  const requested = params.get("tab") ?? "payouts";
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
      {tab === "invites" && <ReferralSettings />}
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
