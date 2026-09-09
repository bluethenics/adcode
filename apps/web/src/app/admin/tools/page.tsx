"use client";

import { AdminShell } from "@/components/AdminShell";
import { TestAdsBody } from "../_sections/TestDelivery";

/** One job on one page: send a safe test card through delivery without moving money. */
export default function ToolsPage() {
  return (
    <AdminShell title="Delivery" subtitle="Push a test ad through the pipeline. No money moves.">
      <TestAdsBody />
    </AdminShell>
  );
}
