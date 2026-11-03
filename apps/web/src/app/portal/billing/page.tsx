"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Billing() {
  const router = useRouter();
  useEffect(() => router.replace("/portal#credits"), [router]);
  return null;
}
