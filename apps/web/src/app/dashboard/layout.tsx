import type { Metadata } from "next";

/*
 * Signed-in, so nothing here belongs in a search result. The nav links this area from
 * every public page, which is exactly how a URL gets indexed without ever being useful;
 * `noindex` is what keeps it out, and robots.txt leaves it crawlable so the tag is seen.
 */
export const metadata: Metadata = {
  title: "Your dashboard",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
