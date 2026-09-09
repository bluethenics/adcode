"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { BlogBody } from "../_sections/Posts";
import { ReleasesBody } from "../_sections/Releases";
import { NoticesBody } from "../_sections/Notices";

const TABS = [
  { id: "writing", label: "Blog and docs" },
  { id: "releases", label: "Releases" },
  { id: "notices", label: "Notices" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const HEADS: Record<TabId, { title: string; subtitle: string }> = {
  writing: {
    title: "Blog and docs",
    subtitle: "The public words, maintained from here.",
  },
  releases: {
    title: "Releases",
    subtitle: "Desktop versions, notes, and publishing.",
  },
  notices: {
    title: "Notices",
    subtitle: "Messages shown inside ADCode.",
  },
};

function ContentBody() {
  const params = useSearchParams();
  const requested = params.get("tab") ?? "writing";
  const tab: TabId = TABS.some((candidate) => candidate.id === requested)
    ? (requested as TabId)
    : "writing";

  return (
    <AdminShell title={HEADS[tab].title} subtitle={HEADS[tab].subtitle} tab={tab}>
      <AdminTabs base="/admin/content" active={tab} tabs={[...TABS]} />
      {tab === "writing" && <BlogBody />}
      {tab === "releases" && <ReleasesBody />}
      {tab === "notices" && <NoticesBody />}
    </AdminShell>
  );
}

export default function ContentPage() {
  return (
    <Suspense fallback={null}>
      <ContentBody />
    </Suspense>
  );
}
