"use client";

import { AdminShell } from "@/components/AdminShell";
import { AdSafety } from "../_sections/AdSafety";
import "@/components/adminSafety.css";

export default function AdSafetyPage() {
  return (
    <AdminShell title="Ad safety" subtitle="Pause ad networks, decide who advertises without review, and release held earnings.">
      <AdSafety />
    </AdminShell>
  );
}
