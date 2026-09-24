import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { WebsiteAnalytics } from "@/components/WebsiteAnalytics";
import { Inter_Tight, JetBrains_Mono, Inter } from "next/font/google";
import { SITE, VERIFICATION, url } from "@/lib/site";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { AuthProvider } from "@/components/AuthProvider";
import { CodeboxCopy } from "@/components/CodeboxCopy";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEME_SCRIPT } from "@/lib/theme";
import { organisation, softwareApplication, webSite } from "@/lib/schema";
import "./globals.css";
import "./design-system.css";
import "./redesign.css";

/*
 * Self-hosted through next/font, so the page makes no request to a font CDN. That keeps
 * the render blocking-free and means the site does not leak a visitor's IP to a third
 * party before they have agreed to anything - which the privacy page then gets to say
 * truthfully.
 *
 * No `weight` on any of the three, deliberately. All three are variable fonts, and naming
 * weights makes next/font download one static instance per weight - eight files where
 * three would do. It was also quietly wrong: this stylesheet asks for weights like 520,
 * 540 and 620, and with only 500/600/700 on the page the browser was synthesising the
 * ones in between by smearing the outlines. The variable font has them for real.
 */
const display = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.origin),
  title: {
    default: `${SITE.name} - ${SITE.tagline}`,
    template: `%s - ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "ad supported IDE",
    "code editor that pays",
    "AI code editor",
    "free IDE",
    "developer earnings",
    "ADCode",
  ],
  authors: [{ name: SITE.name, url: SITE.origin }],
  /*
   * Ownership tokens, and the machine-readable copy of the site.
   *
   * `verification` is what unlocks Search Console and Bing Webmaster Tools - until a host
   * is verified neither will show whether the site is indexed at all, which is the single
   * question worth being able to answer. Both values come from the environment and both
   * are omitted entirely when unset, because an empty `content` attribute reads as a
   * failed verification rather than as no verification.
   *
   * `types` advertises `/llms.txt` from every page. An assistant that lands anywhere on
   * the site then has a link to the version written for it, instead of reconstructing the
   * facts from rendered marketing HTML and getting the revenue share wrong.
   */
  ...(VERIFICATION.google === undefined && VERIFICATION.bing === undefined
    ? {}
    : {
        verification: {
          ...(VERIFICATION.google === undefined ? {} : { google: VERIFICATION.google }),
          ...(VERIFICATION.bing === undefined ? {} : { other: { "msvalidate.01": VERIFICATION.bing } }),
        },
      }),
  alternates: {
    canonical: url("/"),
    types: {
      "text/plain": [{ url: url("/llms.txt"), title: `${SITE.name} for language models` }],
      "application/rss+xml": [{ url: url("/feed.xml"), title: `${SITE.name} updates` }],
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
    url: url("/"),
    locale: SITE.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f7f4" }, { media: "(prefers-color-scheme: dark)", color: "#14120b" }],
  width: "device-width",
  initialScale: 1,
};

/*
 * Async, so the newest version is fetched on the server and the bar is either correct on
 * first paint or absent. Fetching it in the browser would mean a bar that appears a beat
 * after the page settles, which is exactly the kind of movement a reader resents.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>
        <JsonLd data={organisation()} />
        <JsonLd data={webSite()} />
        <JsonLd data={softwareApplication()} />
        <ThemeProvider><AuthProvider>
          <CodeboxCopy />
          <Nav />
          <main id="main">{children}</main>
          <Footer />
          <Suspense fallback={null}><WebsiteAnalytics /></Suspense>
        </AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
