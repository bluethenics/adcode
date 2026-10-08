"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { CampaignLinks } from "@/components/growth/CampaignLinks";
import { GrowthOverview } from "@/components/growth/GrowthOverview";
import { LoopsBoard } from "@/components/growth/LoopsBoard";
import { PartnersTable } from "@/components/growth/PartnersTable";
import { ReferralSettings } from "../_sections/ReferralSettings";
import "@/components/growth/growth.css";

/*
 * Growth: everything that brings people in, in one place. The invite programme's terms were
 * a fourth tab of Money that no sidebar row pointed to, and Sources, campaign links and top
 * referrers sat at the bottom of Analytics - so the operator who had to tick the house
 * advertiser could not find where. Each job is now a tab with its own URL and sidebar row.
 */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "partners", label: "Partners" },
  { id: "links", label: "Links" },
  { id: "loops", label: "Loops" },
  { id: "terms", label: "Terms" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const HEADS: Record<TabId, { title: string; subtitle: string }> = {
  overview: { title: "Growth", subtitle: "What is left to set up, what invites brought in, and where every new person came from." },
  partners: { title: "Partners", subtitle: "The people who invite, what their people and advertisers brought, and what they were paid." },
  links: { title: "Campaign links", subtitle: "One link per post or ad you run, each counted in a row of its own." },
  loops: { title: "Loops", subtitle: "Every place ADCode asks somebody to bring somebody, and what each one sent." },
  terms: { title: "Terms", subtitle: "The rates, ADCode's own advertisers, and settling a day by hand." },
};

function GrowthBody() {
  const params = useSearchParams();
  const requested = params.get("tab") ?? "overview";
  const tab: TabId = TABS.some((candidate) => candidate.id === requested) ? (requested as TabId) : "overview";

  return (
    <AdminShell title={HEADS[tab].title} subtitle={HEADS[tab].subtitle} tab={tab}>
      <AdminTabs base="/admin/growth" active={tab} tabs={[...TABS]} />
      {tab === "overview" && <GrowthOverview />}
      {tab === "partners" && <PartnersTable />}
      {tab === "links" && <CampaignLinks />}
      {tab === "loops" && <LoopsBoard />}
      {tab === "terms" && <ReferralSettings />}
    </AdminShell>
  );
}

export default function GrowthPage() {
  return (
    <Suspense fallback={null}>
      <GrowthBody />
    </Suspense>
  );
}
