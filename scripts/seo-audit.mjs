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
  else pass(`${path} has a description`, `${String(description[1].length)} chars`);

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

async function checkVerification() {
  heading("ownership and indexing");
  const response = await get("/");

  if (/name="google-site-verification"/.test(response.body)) {
    pass("Search Console verification tag present");
  } else {
    fail(
      "Search Console verification tag present",
      "set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION and redeploy - SETUP.md step 21",
    );
  }

  if (/name="msvalidate\.01"/.test(response.body)) pass("Bing verification tag present");
  else warn("Bing verification tag present", "set NEXT_PUBLIC_BING_SITE_VERIFICATION");
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
  await checkSitemap();

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
  await checkPage("/docs", { schema: ["BreadcrumbList"] });

  await checkMachineText();
  await checkVerification();
  await checkParentLink();

  process.stdout.write(
    `\n${String(failures)} failed, ${String(warnings)} warning${warnings === 1 ? "" : "s"}.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
