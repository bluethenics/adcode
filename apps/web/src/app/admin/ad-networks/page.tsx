"use client";

import { AdminShell } from "@/components/AdminShell";
import { AdNetworksAdmin } from "@/components/AdNetworksAdmin";
import "@/components/adminModels.css";
import "@/components/adminTagflow.css";

export default function AdNetworksPage() {
  return <AdminShell title="Ad networks" subtitle="Provider connections, API keys, verified event payouts, and content previews."><AdNetworksAdmin /></AdminShell>;
}
