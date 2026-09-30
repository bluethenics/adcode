/**
 * Audit the *running* site for the things that decide whether it can be found.
 *
 * `npm run verify` asserts the model: that `robots()` returns a rule naming GPTBot, that
 * `sitemap()` contains no redirect stubs, that the canonical is on the brand host. Every
 * one of those passed on the day the live site was serving `User-agent: GPTBot
 * Disallow: /`, because the deny came from Cloudflare's managed robots block and was
 * prepended to the response after Next had produced its half of the file. A test of a
 * function cannot see a header the platform adds; only a fetch can.
 *
 * That is the whole reason this exists, and it is the same reason `smoke.mjs` exists for
 * the desktop app: the acceptance test is the artefact, not the unit that built it.
 *
 *   node scripts/seo-audit.mjs                      # audit the canonical host
 *   node scripts/seo-audit.mjs http://localhost:3000
 *
 * Exit code 1 if any check fails. Read the printed lines rather than only the code - a
 * WARN is a thing to fix this week, not a thing that is broken now.
 */

import { resolveTxt } from "node:dns/promises";

const DEFAULT_ORIGIN = "https://adcode.bluethenics.com";
const origin = (process.argv[2] ?? process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? DEFAULT_ORIGIN).replace(
  /\/$/,
  "",
);

/**
 * The agents whose access decides whether an assistant can quote this site.
 *
 * Named individually because that is how they appear in a managed block. A substring
 * search for "Disallow" over the whole file would flag the site's own private-area rules,
 * which are correct and deliberate.
 */
const ANSWER_ENGINES = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "meta-externalagent",
  "Applebot-Extended",
];

let failures = 0;
let warnings = 0;

const pass = (label, detail) => {
  process.stdout.write(`  ok    ${label}${detail === undefined ? "" : ` - ${detail}`}\n`);
};

const warn = (label, detail) => {
  warnings += 1;
  process.stdout.write(`  WARN  ${label}${detail === undefined ? "" : ` - ${detail}`}\n`);
};

const fail = (label, detail) => {
  failures += 1;
  process.stdout.write(`  FAIL  ${label}${detail === undefined ? "" : ` - ${detail}`}\n`);
};

const heading = (text) => {
  process.stdout.write(`\n${text}\n`);
};

async function get(path) {
  const started = Date.now();
  try {
    const response = await fetch(`${origin}${path}`, {
      redirect: "manual",
      headers: { "user-agent": "adcode-seo-audit" },
    });
    return {
      status: response.status,
      body: await response.text(),
      headers: response.headers,
      ms: Date.now() - started,
    };
  } catch (error) {
    return { status: 0, body: "", headers: new Headers(), ms: Date.now() - started, error };
  }
}

/**
 * Parse robots.txt into groups.
 *
 * A group is one or more consecutive `User-agent` lines followed by its rules, which is
 * why this cannot be a line-by-line scan: `User-agent: A` / `User-agent: B` / `Allow: /`
 * is one group covering both agents, and reading it as two would miss half the file.
 */
function parseRobots(text) {
  const groups = [];
  let current = null;
  let collectingAgents = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (current === null || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value);
      continue;
    }

    if (field === "allow" || field === "disallow") {
      collectingAgents = false;
      if (current !== null) current.rules.push({ field, value });
    }
  }

  return groups;
}

/** Every rule that applies to one named agent, in file order. */
const rulesFor = (groups, agent) =>
  groups
    .filter((group) => group.agents.some((name) => name.toLowerCase() === agent.toLowerCase()))
    .flatMap((group) => group.rules);

async function checkRobots() {
  heading("robots.txt");
  const response = await get("/robots.txt");

  if (response.status !== 200) {
    fail("robots.txt reachable", `HTTP ${String(response.status)}`);
    return;
  }
  pass("robots.txt reachable");

  const groups = parseRobots(response.body);

  /*
   * Cloudflare's managed block, which is the finding this script was written to catch.
   * It is prepended to the response, so it is invisible to every test that reads
   * `src/app/robots.ts`.
   */
  if (/BEGIN Cloudflare Managed content/i.test(response.body)) {
    fail(
      "no platform-injected robots block",
      "Cloudflare's managed robots.txt is prepended. Turn it off: Cloudflare > the zone > AI Crawl Control. SETUP.md step 20.",
    );
  } else {
    pass("no platform-injected robots block");
  }

  const signal = /^\s*Content-Signal:\s*(.+)$/im.exec(response.body);
  if (signal !== null && /ai-train\s*=\s*no/i.test(signal[1])) {
    fail("content signal permits AI training", signal[1].trim());
  } else if (signal !== null) {
    pass("content signal permits AI training", signal[1].trim());
  } else {
    pass("content signal permits AI training", "no Content-Signal set");
  }

  for (const agent of ANSWER_ENGINES) {
    const rules = rulesFor(groups, agent);
    if (rules.length === 0) {
      // Covered by `User-agent: *`, which allows. Not a problem, just not explicit.
      continue;
    }
    const blocked = rules.some((rule) => rule.field === "disallow" && rule.value === "/");
    const allowed = rules.some((rule) => rule.field === "allow" && rule.value === "/");

    if (blocked && allowed) {
      fail(`${agent} has one consistent rule`, "both Allow: / and Disallow: / apply to it");
    } else if (blocked) {
      fail(`${agent} may crawl`, "Disallow: /");
    } else {
      pass(`${agent} may crawl`);
    }
  }

  if (response.body.includes("/sitemap.xml")) pass("robots.txt names the sitemap");
  else fail("robots.txt names the sitemap");
}

async function checkSitemap() {
  heading("sitemap.xml");
  const response = await get("/sitemap.xml");

  if (response.status !== 200) {
    fail("sitemap reachable", `HTTP ${String(response.status)}`);
    return [];
  }

  const locations = [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  pass("sitemap reachable", `${String(locations.length)} URLs`);

  /*
   * Same build-time-origin caveat as the canonical check: a local build emits production
   * URLs here, correctly. So the assertion is "one host, and it is the one the build
   * declares", which is the property that actually matters - a sitemap mixing hosts is
   * the bug, not a sitemap naming a host other than the one it happens to be served from.
   */
  const hosts = new Set(locations.map((location) => new URL(location).origin));
  const declared = [...hosts][0] ?? origin;

  if (hosts.size > 1) fail("every sitemap URL is on one host", [...hosts].join(", "));
  else if (declared === origin) pass("every sitemap URL is on the canonical host");
  else if (origin.startsWith("http://localhost"))
    pass("every sitemap URL is on one host", `${declared}, as a local build should`);
  else fail("every sitemap URL is on the canonical host", declared);

  const paths = new Set(locations.map((location) => new URL(location).pathname));

  /*
   * The landing pages are the entire point of the content work; a sitemap that omits them
   * means the only route in is the footer, and the only reason they would be missing is
   * that `LANDINGS` and the sitemap stopped agreeing.
   */
  for (const path of [
    "/free-ai-code-editor",
    "/earn-while-you-code",
    "/compare",
    "/compare/vscode",
    "/compare/cursor",
    "/compare/idlen",
    "/compare/windsurf",
    "/compare/copilot",
  ]) {
    if (paths.has(path)) pass(`sitemap lists ${path}`);
    else fail(`sitemap lists ${path}`);
  }

  return locations;
}

async function checkPage(path, { needs = [], schema = [] } = {}) {
  const response = await get(path);

  if (response.status !== 200) {
    fail(`${path} returns 200`, `HTTP ${String(response.status)}`);
    return;
  }

  /*
   * The canonical, judged by path rather than by whole URL when auditing somewhere else.
   *
   * `NEXT_PUBLIC_SITE_ORIGIN` is inlined at build time, so a build served from
   * `localhost:4600` correctly emits a canonical naming the production host - that is the
   * point of a canonical and it would be wrong to change. Comparing the full URL made
   * every page fail on a local run, which trains you to ignore the section that matters
   * most in a real one. So: the path must always match, and a differing host is a note
   * when auditing a non-canonical origin and a failure when auditing the real thing.
   */
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(response.body);
  const trim = (value) => value.replace(/\/$/, "");

  if (canonical === null) {
    fail(`${path} has a canonical`);
  } else {
    const found = new URL(canonical[1]);
    const pathMatches = trim(found.pathname) === trim(path);
    const hostMatches = trim(found.origin) === trim(origin);

    if (!pathMatches) fail(`${path} canonical points at itself`, canonical[1]);
    else if (hostMatches) pass(`${path} canonical points at itself`);
    else if (origin.startsWith("http://localhost"))
      pass(`${path} canonical points at itself`, `names ${found.origin}, as a local build should`);
    else fail(`${path} canonical is on the canonical host`, canonical[1]);
  }

  if (/<meta name="robots"[^>]*noindex/i.test(response.body)) fail(`${path} is indexable`, "noindex");

  const title = /<title>([^<]*)<\/title>/.exec(response.body);
  if (title === null || title[1].trim() === "") fail(`${path} has a title`);
  else if (title[1].length > 65)
    warn(`${path} title fits a result`, `${String(title[1].length)} chars: ${title[1]}`);
  else pass(`${path} has a title`, title[1]);

  const description = /<meta name="description" content="([^"]*)"/.exec(response.body);
  if (description === null || description[1].trim() === "") fail(`${path} has a description`);
  else if (decode(description[1]).length > 160)
    warn(`${path} description fits a snippet`, `${String(decode(description[1]).length)} chars`);
  else pass(`${path} has a description`, `${String(decode(description[1]).length)} chars`);

  checkShareCard(path, response.body);

  for (const type of schema) {
    if (response.body.includes(`"@type":"${type}"`)) pass(`${path} emits ${type}`);
    else fail(`${path} emits ${type}`);
  }

  for (const needle of needs) {
    if (response.body.includes(needle)) pass(`${path} contains ${needle}`);
    else fail(`${path} contains ${needle}`);
  }

  if (response.ms > 2500) warn(`${path} responds promptly`, `${String(response.ms)}ms`);
  else pass(`${path} responds promptly`, `${String(response.ms)}ms`);
}

/** The few entities Next escapes in attribute values, so lengths count characters. */
const decode = (text) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const metaContent = (body, attribute, name) =>
  new RegExp(`<meta ${attribute}="${name.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`).exec(body)?.[1];

/**
 * What a link unfurls to on X, Slack, Discord, LinkedIn and in iMessage.
 *
 * Next merges metadata shallowly, so a page that sets `openGraph` silently loses the
 * layout's image, and one that sets nothing inherits the homepage's `og:url`. For a month
 * 120 of 126 pages had no share image and `/versions` introduced itself as the homepage;
 * every head test passed, because they asserted the fields each page set, not the fields
 * the rendered page lacked. Only reading the served HTML sees both.
 */
/** The share card's gaps, as short phrases. Empty when it is complete. */
function shareCardProblems(path, body) {
  const problems = [];
  const ogImage = metaContent(body, "property", "og:image");
  const twitterImage = metaContent(body, "name", "twitter:image");
  const ogUrl = metaContent(body, "property", "og:url");
  const trim = (value) => value.replace(/\/$/, "");

  if (ogImage === undefined) problems.push("no og:image");
  if (twitterImage === undefined) problems.push("no twitter:image");
  if (ogUrl === undefined) problems.push("no og:url");
  else if (trim(new URL(ogUrl).pathname) !== trim(path)) problems.push(`og:url is ${ogUrl}`);

  return problems;
}

function checkShareCard(path, body) {
  const problems = shareCardProblems(path, body);
  if (problems.length > 0) fail(`${path} has a complete share card`, problems.join(", "));
  else pass(`${path} has a complete share card`);
}

/**
 * Every URL the sitemap lists, not only the handful above.
 *
 * The named pages are the ones worth a line each; this is the sweep that catches the one
 * generated docs page among a hundred whose head came out wrong. Quiet on success so a
 * clean run is still readable, and on a broken one it names the first few pages rather than
 * burying the rest of the report under a hundred identical lines.
 */
async function checkEveryPage(locations) {
  heading(`every sitemap page (${String(locations.length)})`);
  const titles = new Map();
  const incomplete = [];
  let longDescriptions = 0;
  const queue = [...locations];

  const worker = async () => {
    while (queue.length > 0) {
      const location = queue.shift();
      const path = new URL(location).pathname;
      const response = await get(path);
      if (response.status !== 200) {
        fail(`${path} returns 200`, `HTTP ${String(response.status)}`);
        continue;
      }
      const problems = shareCardProblems(path, response.body);
      if (problems.length > 0) incomplete.push(`${path} (${problems.join(", ")})`);

      const title = /<title>([^<]*)<\/title>/.exec(response.body)?.[1];
      if (title !== undefined) titles.set(title, [...(titles.get(title) ?? []), path]);

      const description = metaContent(response.body, "name", "description");
      if (description === undefined) fail(`${path} has a description`);
      else if (decode(description).length > 160) longDescriptions += 1;

      const h1 = (response.body.match(/<h1[\s>]/g) ?? []).length;
      if (h1 !== 1) warn(`${path} has one h1`, `${String(h1)} found`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  if (incomplete.length === 0) pass("every page has a complete share card");
  else {
    fail("every page has a complete share card", `${String(incomplete.length)} of ${String(locations.length)} do not`);
    for (const line of incomplete.sort().slice(0, 10)) process.stdout.write(`          ${line}
`);
    if (incomplete.length > 10) process.stdout.write(`          ...and ${String(incomplete.length - 10)} more
`);
  }

  if (longDescriptions === 0) pass("every description fits a snippet");
  else warn("every description fits a snippet", `${String(longDescriptions)} longer than 160 chars`);

  const duplicates = [...titles].filter(([, paths]) => paths.length > 1);
  if (duplicates.length === 0) pass("every title is unique");
  else for (const [title, paths] of duplicates) warn(`title is unique: ${title}`, paths.join(" "));
}

/**
 * Retired routes, the insecure scheme, and the areas that must stay out of the index.
 */
async function checkRouting() {
  heading("redirects and indexing rules");

  /*
   * Permanent, and to the page that replaced them. These were 307s - temporary, so a
   * search engine kept the old URL and moved nothing it had earned - and every old post
   * went to the homepage rather than to where it now lives.
   */
  for (const [from, to] of [
    ["/blog", "/docs"],
    ["/blog/why-the-ledger-is-append-only", "/docs/why-the-ledger-is-append-only"],
    ["/changelog", "/versions"],
    ["/download", "/versions"],
    ["/advertise", "/#advertise"],
  ]) {
    const response = await get(from);
    const location = response.headers.get("location") ?? "";
    const target = location === "" ? "" : new URL(location, origin);
    const lands = target === "" ? "" : `${target.pathname}${target.hash}`;

    if (response.status !== 308 && response.status !== 301)
      fail(`${from} moves permanently`, `HTTP ${String(response.status)} to ${location || "nowhere"}`);
    else if (lands !== to) fail(`${from} moves to ${to}`, location);
    else pass(`${from} moves permanently to ${to}`);
  }

  /*
   * Plain http must not serve the site. Both schemes answering 200 is two copies of every
   * page; the canonical tag points at https, but a tag is a hint and a redirect is not.
   * `middleware.ts` does it for pages; Cloudflare's "Always Use HTTPS" (SSL/TLS > Edge
   * Certificates) also covers the bare files the middleware matcher skips.
   */
  if (origin.startsWith("https://")) {
    const insecure = await fetch(origin.replace(/^https:/, "http:") + "/", {
      redirect: "manual",
      headers: { "user-agent": "adcode-seo-audit" },
    }).catch(() => null);
    const location = insecure?.headers.get("location") ?? "";

    if (insecure === null) warn("http redirects to https", "http:// did not answer");
    else if ([301, 308].includes(insecure.status) && location.startsWith("https://"))
      pass("http redirects to https", `${String(insecure.status)}`);
    else
      fail(
        "http redirects to https",
        `HTTP ${String(insecure.status)} - the middleware redirect is not live; or turn on Cloudflare > SSL/TLS > Edge Certificates > Always Use HTTPS`,
      );

    const secure = await get("/");
    if (/max-age=\d{7,}/.test(secure.headers.get("strict-transport-security") ?? ""))
      pass("HSTS is set");
    else warn("HSTS is set", "no Strict-Transport-Security header");
  }

  for (const path of ["/portal", "/dashboard"]) {
    const response = await get(path);
    if (/<meta name="robots"[^>]*noindex/i.test(response.body)) pass(`${path} is noindex`);
    else fail(`${path} is noindex`, "signed-in page is indexable");
  }
}

async function checkMachineText() {
  heading("machine-readable text");

  for (const path of ["/llms.txt", "/llms-full.txt"]) {
    const response = await get(path);
    if (response.status !== 200) {
      fail(`${path} reachable`, `HTTP ${String(response.status)}`);
      continue;
    }
    pass(`${path} reachable`, `${String(Math.round(response.body.length / 1024))}KB`);

    /*
     * Dead links in these files are worse than dead links on a page: the reader is a
     * machine that will not notice it was redirected to the homepage and will summarise
     * the homepage as though it were the page it asked for. `/download` and `/advertise`
     * are redirect stubs and were both advertised here for months.
     */
    for (const stub of ["/download", "/advertise)", "/blog/"]) {
      if (response.body.includes(`${origin}${stub}`)) fail(`${path} links no redirect stubs`, stub);
    }
    if (
      !response.body.includes(`${origin}/download`) &&
      !response.body.includes(`${origin}/advertise)`)
    ) {
      pass(`${path} links no redirect stubs`);
    }
  }
}

/**
 * DNS TXT records on the host and every parent domain, joined into strings.
 *
 * A Search Console *domain* property is verified by a TXT record, and one on
 * `bluethenics.com` covers `adcode.bluethenics.com` - which is how this site is actually
 * verified. Checking only for the meta tag reported "not verified" about a property that
 * had been collecting data for a month.
 */
async function txtRecordsUpward(host) {
  const labels = host.split(".");
  const found = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    const name = labels.slice(i).join(".");
    const records = await resolveTxt(name).catch(() => []);
    for (const record of records) found.push({ name, value: record.join("") });
  }
  return found;
}

async function checkVerification() {
  heading("ownership and indexing");
  const response = await get("/");
  const host = new URL(origin).hostname;
  const txt = host === "localhost" ? [] : await txtRecordsUpward(host);

  const googleDns = txt.find((record) => record.value.startsWith("google-site-verification="));
  if (/name="google-site-verification"/.test(response.body)) {
    pass("Search Console ownership verified", "meta tag");
  } else if (googleDns !== undefined) {
    pass("Search Console ownership verified", `DNS TXT on ${googleDns.name}`);
  } else if (host === "localhost") {
    pass("Search Console ownership verified", "not checkable on localhost - DNS proves it in production");
  } else {
    fail(
      "Search Console ownership verified",
      "no meta tag and no google-site-verification TXT record - SETUP.md step 21",
    );
  }

  /*
   * Bing is a warning, not a failure: IndexNow already hands it every URL, and Bing
   * Webmaster Tools imports the property from Search Console in two clicks.
   */
  if (/name="msvalidate\.01"/.test(response.body)) pass("Bing Webmaster Tools verified", "meta tag");
  else warn("Bing Webmaster Tools verified", "sign in at bing.com/webmasters and import from Search Console");
}

async function checkParentLink() {
  heading("the parent brand");
  const response = await get("/");

  /*
   * The parent root, not the substring.
   *
   * The first version of this check searched for "bluethenics.com", which the canonical
   * host `adcode.bluethenics.com` contains - so it passed on a page with no link to the
   * studio at all. A check that cannot fail is worse than no check, because it reports
   * success for the thing it was written to catch.
   */
  if (response.body.includes('href="https://bluethenics.com/'))
    pass("site links to the publishing studio");
  else fail("site links to the publishing studio", "no href to https://bluethenics.com/");

  const parent = await fetch("https://bluethenics.com/", {
    headers: { "user-agent": "adcode-seo-audit" },
  })
    .then(async (r) => ({ status: r.status, body: await r.text() }))
    .catch(() => ({ status: 0, body: "" }));

  if (parent.status !== 200) {
    warn("the studio site is reachable", `HTTP ${String(parent.status)}`);
    return;
  }

  /*
   * The edge has to be asserted from both ends. ADCode claiming a parent that never
   * mentions it is one site talking about itself; the pair is what a knowledge graph can
   * actually use.
   */
  if (parent.body.includes("adcode.bluethenics.com")) pass("the studio site links back to ADCode");
  else fail("the studio site links back to ADCode", "deploy bluethenics-web");

  if (parent.body.includes("subOrganization") || parent.body.includes("adcode.bluethenics.com/#organization"))
    pass("the studio asserts the organisation edge");
  else warn("the studio asserts the organisation edge", "no subOrganization in its JSON-LD");
}

async function main() {
  process.stdout.write(`ADCode SEO audit - ${origin}\n`);

  await checkRobots();
  const locations = await checkSitemap();

  heading("pages");
  await checkPage("/", {
    schema: ["Organization", "WebSite", "SoftwareApplication", "FAQPage"],
    needs: ["parentOrganization", "SearchAction"],
  });
  await checkPage("/free-ai-code-editor", { schema: ["Article", "FAQPage", "BreadcrumbList"] });
  await checkPage("/earn-while-you-code", { schema: ["Article", "FAQPage"] });
  await checkPage("/compare", { schema: ["ItemList", "BreadcrumbList"] });
  await checkPage("/compare/vscode", { schema: ["Article", "FAQPage"] });
  await checkPage("/compare/cursor", { schema: ["Article", "FAQPage"] });
  await checkPage("/compare/idlen", { schema: ["Article", "FAQPage"] });
  await checkPage("/compare/windsurf", { schema: ["Article", "FAQPage"] });
  await checkPage("/compare/copilot", { schema: ["Article", "FAQPage"] });
  await checkPage("/docs", { schema: ["BreadcrumbList"] });
  await checkPage("/versions", { schema: ["BreadcrumbList", "HowTo", "FAQPage"] });

  await checkEveryPage(locations);
  await checkRouting();
  await checkMachineText();
  await checkVerification();
  await checkParentLink();

  process.stdout.write(
    `\n${String(failures)} failed, ${String(warnings)} warning${warnings === 1 ? "" : "s"}.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
