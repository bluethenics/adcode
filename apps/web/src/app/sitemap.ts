import type { MetadataRoute } from "next";
import { url } from "@/lib/site";

/** Only canonical public pages. Product workspaces are private and secondary routes redirect. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/versions"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
