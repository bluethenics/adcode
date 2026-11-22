/** Only the public launch page belongs in search; app and preview data never do. */
export const PUBLIC_APP_HOST = "web.bluethenics.com";
export const LAUNCH_ROBOTS = '<meta name="robots" content="noindex, nofollow" data-adcode-public-launch />';
export const INDEXABLE_LAUNCH_ROBOTS = '<meta name="robots" content="index, follow, max-image-preview:large" data-adcode-public-launch />';
/** SHA-256 of the fixed JSON-LD in desktop/src/web/seo.ts; a regression test keeps them aligned. */
export const WEB_APP_SCHEMA_CSP = "'sha256-GN7/NGhrsZcHvJ6N0gaRjMMuBnGh0CGDAPIu9IJPZbs='";
/** The preserved execution page has the previous fixed description. */
export const LEGACY_WEB_APP_SCHEMA_CSP = "'sha256-Cit+u4tN6c/QTNvKcbIR9X6SQXeY50pEAEWPIJOJjbs='";

export function publicAppHost(hostname: string, appHost: string, allowDevToken?: string): boolean {
  return hostname === PUBLIC_APP_HOST && appHost === PUBLIC_APP_HOST && allowDevToken !== "1";
}

/** No invented lastmod date: the only public URL is the launch page. */
export function sitemap(publicHost: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicHost ? `<url><loc>https://${PUBLIC_APP_HOST}/</loc></url>` : ""}</urlset>\n`;
}

export function robots(publicHost: boolean): string {
  return publicHost
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\nDisallow: /socket\nDisallow: /__\n\nSitemap: https://${PUBLIC_APP_HOST}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
}
