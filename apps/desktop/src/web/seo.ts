import { markRows } from "./asciiMark.ts";
import { DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";

/** Public launch copy is shipped in HTML, before sign-in or any private workspace loads. */
const SITE = "https://adcode.bluethenics.com";
const APP = "https://web.bluethenics.com/";
const TITLE = "ADCode Web — AI Code Editor in Your Browser";
const DESCRIPTION = "The ADCode assistant in your browser: open a GitHub repository, let AI read and change it, and send the changes back as a pull request. Nothing to install.";
export const WEB_APP_HEADING = "Build apps with AI in your browser";
export const WEB_APP_INTRO = "Open a GitHub repository and the same assistant as the desktop app works on it right in this tab. Your changes go back to GitHub as a pull request.";
export const WEB_APP_GUIDE_URL = `${SITE}/online-ai-code-editor`;
export const WEB_APP_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${APP}#app`,
  name: "ADCode Web",
  url: APP,
  description: DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web browser",
  browserRequirements: "Requires JavaScript and sign-in.",
  publisher: { "@id": `${SITE}/#organization` },
});

/**
 * Builds remain noindex until the production Worker explicitly opens the public root.
 * The marker lets an older or incomplete build stay closed rather than index an empty shell.
 */
export function webAppHead(): string {
  return [
    `<title>${TITLE}</title>`,
    '<meta name="robots" content="noindex, nofollow" data-adcode-public-launch />',
    `<meta name="description" content="${DESCRIPTION}" />`,
    `<link rel="canonical" href="${APP}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="ADCode" />',
    `<meta property="og:title" content="${TITLE}" />`,
    `<meta property="og:description" content="${DESCRIPTION}" />`,
    `<meta property="og:url" content="${APP}" />`,
    `<meta property="og:image" content="${SITE}/opengraph-image.png" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${TITLE}" />`,
    `<meta name="twitter:description" content="${DESCRIPTION}" />`,
    `<meta name="twitter:image" content="${SITE}/opengraph-image.png" />`,
    `<script type="application/ld+json" id="adcode-web-app-schema">${WEB_APP_SCHEMA}</script>`,
  ].join("\n    ");
}

/**
 * The same useful introduction is visible to people and crawlers while sign-in loads - under
 * the login page's ASCII mark, shipped as two static sweeps (its lightest and heaviest) that
 * the critical CSS slides across each other. The gate then mounts the animated canvas on the
 * same picture, so the splash is the loading screen, not a placeholder for one.
 */
export const WEB_APP_SPLASH = `<div class="web-splash">
      <div class="web-splash-mark" aria-hidden="true"><pre>${markRows(0).join("\n")}</pre><pre>${markRows(1).join("\n")}</pre></div>
      <div class="web-splash-copy">
        <h1>${WEB_APP_HEADING}</h1>
        <p>${WEB_APP_INTRO}</p>
      </div>
      <nav aria-label="About ADCode Web"><a href="${WEB_APP_GUIDE_URL}">How it works</a><a href="${SITE}/docs">Documentation</a><a href="${SITE}/privacy">Privacy</a></nav>
      <noscript><p>JavaScript is required to sign in and use the editor. The guide and documentation above work without signing in.</p></noscript>
    </div>`;

/*
 * The web version is paused: production builds ship this notice instead of the app in
 * `vite.web.config.ts`. The desktop app and local development (`npm run web:vibe`) are
 * untouched; flipping production back to the launch page is one line in that config.
 */
export const WEB_APP_PAUSED_HEADING = "The web version is paused";
export const WEB_APP_PAUSED_INTRO = "We're not ready for a web release yet. Use the ADCode desktop app to build with AI, run commands and preview your work on your own computer.";

const PAUSED_TITLE = "ADCode Web is paused — try the desktop app";
const PAUSED_DESCRIPTION = "The ADCode web version is paused while we get it ready. Use the desktop app to build with AI on your computer.";

/** The paused page's head: noindex, no application schema, and honest share text. */
export function webPausedHead(): string {
  return [
    `<title>${PAUSED_TITLE}</title>`,
    '<meta name="robots" content="noindex, nofollow" />',
    `<meta name="description" content="${PAUSED_DESCRIPTION}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="ADCode" />',
    `<meta property="og:title" content="${PAUSED_TITLE}" />`,
    `<meta property="og:description" content="${PAUSED_DESCRIPTION}" />`,
    '<meta property="og:url" content="https://web.bluethenics.com/" />',
    `<meta property="og:image" content="${SITE}/opengraph-image.png" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
  ].join("\n    ");
}

/** The paused page, in HTML alone: it renders before (and without) any script. */
export const WEB_APP_PAUSED_SPLASH = `<div class="web-splash">
      <div class="web-splash-mark" aria-hidden="true"><pre>${markRows(0).join("\n")}</pre><pre>${markRows(1).join("\n")}</pre></div>
      <div class="web-splash-copy">
        <h1>${WEB_APP_PAUSED_HEADING}</h1>
        <p>${WEB_APP_PAUSED_INTRO}</p>
      </div>
      <div class="web-paused-actions">
        <a class="web-paused-primary" href="${DESKTOP_DOWNLOAD_URL}">Get the desktop app</a>
        <a class="web-paused-link" href="${SITE}">Visit adcode.bluethenics.com</a>
      </div>
    </div>`;
