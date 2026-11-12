import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Manrope, Geist_Mono } from "next/font/google";
import { SITE, VERIFICATION } from "@/lib/site";
import { ALTERNATE_TYPES, SHARE_IMAGE } from "@/lib/seo";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { BuckGuide } from "@/components/buck/BuckGuide";
import { JsonLd } from "@/components/JsonLd";
import { AuthProvider } from "@/components/AuthProvider";
import { CodeboxCopy } from "@/components/CodeboxCopy";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEME_SCRIPT } from "@/lib/theme";
import { STALE_DEPLOY_SCRIPT } from "@/lib/staleDeploy";
import { organisation, softwareApplication, webSite } from "@/lib/schema";
import "./globals.css";
import "./design-system.css";
import "./redesign.css";
import "./home-landing.css";
import "./site-pages.css";
import "./header-status.css";
import "./auth.css";

/*
 * Space Grotesk gives headings their character, Manrope keeps body copy easy to read,
 * and Geist Mono carries code and numbers. Loading them once in the root layout makes
 * the same typography available throughout the website through the existing variables.
 *
 * next/font downloads and self-hosts the files at build time, so the browser makes no
 * request to Google. Omitting weight preserves each font's variable weight range.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = Geist_Mono({
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
  /*
   * No canonical and no `og:url` here. Whatever the layout says is inherited by every page
   * that does not say otherwise, and "this page is the homepage" is the one inherited claim
   * that is always false. Public pages state their own through `pageMetadata()`; a page
   * that forgets gets no canonical, which a crawler treats as self-referencing.
   */
  alternates: { types: ALTERNATE_TYPES },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
    locale: SITE.locale,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
    images: [{ url: SHARE_IMAGE.url, alt: SHARE_IMAGE.alt }],
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
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /><script dangerouslySetInnerHTML={{ __html: STALE_DEPLOY_SCRIPT }} /></head>
      <body>
        <JsonLd data={organisation()} />
        <JsonLd data={webSite()} />
        <JsonLd data={softwareApplication()} />
        <ThemeProvider><AuthProvider>
          <CodeboxCopy />
          <Nav />
          <main id="main">{children}</main>
          <Footer />
          <BuckGuide />
        </AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
