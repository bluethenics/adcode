"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { ReviewQueue } from "../_sections/CreativeQueue";
import { ReportsBody } from "../_sections/Feedback";

const TABS = [
  { id: "creatives", label: "Creatives" },
  { id: "feedback", label: "Feedback" },
];

function ReviewBody() {
  const params = useSearchParams();
  const tab = params.get("tab") === "feedback" ? "feedback" : "creatives";
  const q = params.get("q") ?? "";

  return (
    <AdminShell
      title={tab === "feedback" ? "Feedback" : "Creatives"}
      subtitle={
        tab === "feedback"
          ? "Reports and questions sent from inside ADCode."
          : "Approve or reject ads before they reach developers."
      }
      tab={tab}
    >
      <AdminTabs base="/admin/review" active={tab} tabs={TABS} />
      {tab === "feedback" ? (
        /* `key` re-reads a fresh jump-box query rather than keeping a stale search. */
        <ReportsBody key={q} initialQuery={q} />
      ) : (
        <ReviewQueue />
      )}
    </AdminShell>
  );
}

export default function ReviewPage() {
  /* useSearchParams needs a boundary; the real gate is AdminShell's auth check. */
  return (
    <Suspense fallback={null}>
      <ReviewBody />
    </Suspense>
  );
}
