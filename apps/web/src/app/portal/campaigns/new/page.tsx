"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NewCampaign() {
  const router = useRouter();
  useEffect(() => router.replace("/portal#new-campaign"), [router]);
  return null;
}
