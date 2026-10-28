import type { Metadata } from "next";

/* A frame inside the desktop app, never a page anyone should find in a search. */
export const metadata: Metadata = {
  title: "Sponsored",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
