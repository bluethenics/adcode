import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The web app manifest.
 *
 * Not an install prompt - the product is a desktop app, and this site is not trying to be
 * one. It is the file browsers, launchers and search engines read for the site's name,
 * short name, colours and icon, so a pinned tab or a shortcut says "ADCode" with the mark
 * rather than a truncated page title and a screenshot.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} - ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#14120b",
    theme_color: "#14120b",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/favicon.ico", sizes: "256x256", type: "image/x-icon" },
    ],
  };
}
