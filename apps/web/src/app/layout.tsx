import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono, Inter } from "next/font/google";
import { SITE, url } from "@/lib/site";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { AuthProvider } from "@/components/AuthProvider";
import { organisation, softwareApplication } from "@/lib/schema";
import "./globals.css";

/*
 * Self-hosted through next/font, so the page makes no request to a font CDN. That keeps
 * the render blocking-free and means the site does not leak a visitor's IP to a third
 * party before they have agreed to anything - which the privacy page then gets to say
 * truthfully.
 */
const display = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
  alternates: { canonical: url("/") },
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
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <JsonLd data={organisation()} />
        <JsonLd data={softwareApplication()} />
        <AuthProvider>
          <Nav />
          <main id="main">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
