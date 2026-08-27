import type { MetadataRoute } from "next";
import { url } from "@/lib/site";

/**
 * Crawling rules.
 *
 * Answer engines are allowed everywhere the public site is. Blocking them is a choice
 * some sites make; for a product whose whole pitch is "we tell you the real numbers",
 * being quotable is the point.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Signed-in areas: nothing to index, and every URL under them redirects.
        disallow: ["/portal/", "/dashboard/", "/admin/", "/support", "/api/"],
      },
    ],
    sitemap: url("/sitemap.xml"),
    host: url("/"),
  };
}
