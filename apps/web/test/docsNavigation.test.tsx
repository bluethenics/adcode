import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected away from documentation");
  },
  usePathname: () => "/docs/workbench-all-features",
}));

import DocsIndex from "../src/app/docs/page";
import sitemap from "../src/app/sitemap";
import { DocsSearch, docsSearchKeyAction } from "../src/components/DocsSearch";
import { Nav } from "../src/components/Nav";
import { allDocs, getDoc, type DocSection } from "../src/lib/docs";

const SEARCH_SECTIONS: DocSection[] = [
  {
    title: "Languages",
    pages: [
      {
        slug: "python-debugging",
        title: "Debug Python",
        section: "Languages",
        description: "Pause a Python program at a breakpoint and inspect every value.",
        body: "",
        related: [],
        order: 0,
        authored: false,
      },
      {
        slug: "typescript-intelligence",
        title: "TypeScript intelligence",
        section: "Languages",
        description: "Accurate suggestions and navigation for TypeScript projects.",
        body: "",
        related: [],
        order: 1,
        authored: false,
      },
    ],
  },
  {
    title: "Git",
    pages: [
      {
        slug: "git-history",
        title: "File history",
        section: "Git",
        description: "Open earlier versions of the current file.",
        body: "",
        related: [],
        order: 0,
        authored: false,
      },
    ],
  },
];

function renderSearch(query: string): string {
  return renderToStaticMarkup(
    <DocsSearch sections={SEARCH_SECTIONS} initialQuery={query} />,
  );
}

/**
 * `?q=` is read on the server so the `SearchAction` in `webSite()` is a true claim, which
 * makes `searchParams` a required prop. Passing an empty object here is the bare `/docs`
 * request; `renderDocsIndex("terminal")` is the URL a crawler builds from the template.
 */
async function renderDocsIndex(query?: string): Promise<string> {
  const searchParams = Promise.resolve(query === undefined ? {} : { q: query });
  const stream = await renderToReadableStream(await DocsIndex({ searchParams }));
  return new Response(stream).text();
}

describe("public documentation navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")));
  });

  it("offers Docs in the shared header and marks every docs article as current", () => {
    const markup = renderToStaticMarkup(<Nav />);

    expect(markup).toContain('href="/docs"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">Docs</a>");
  });

  it("renders the generated feature guide instead of redirecting readers home", async () => {
    const markup = await renderDocsIndex();

    expect(markup).toContain("Every feature, explained");
    expect(markup).toContain('href="/docs/workbench-all-features"');
    expect(markup).toContain("All Features");
    expect(markup).toContain("adcode open");
  });

  it("exposes a compact section rail and distinct entries to the responsive stylesheet", async () => {
    const markup = await renderDocsIndex();

    expect(markup).toContain('class="docs-sidebar-primary"');
    expect(markup).toContain('class="docs-index-item"');
  });

  it("offers an accessible search for the documentation index", async () => {
    const markup = await renderDocsIndex();

    expect(markup).toContain('role="search"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('placeholder="Search documentation"');
    expect(markup).toContain("Press <kbd>/</kbd> to search");
  });

  it("matches every search word and preserves the matching section", () => {
    const markup = renderSearch("python breakpoint");

    expect(markup).toContain("Languages");
    expect(markup).toContain('href="/docs/python-debugging"');
    expect(markup).toContain("1 page found");
    expect(markup).not.toContain("typescript-intelligence");
    expect(markup).not.toContain("git-history");
  });

  it("directs readers when no documentation matches", () => {
    const markup = renderSearch("cobol payments");

    expect(markup).toContain("No documentation found");
    expect(markup).toContain("Try a feature name or describe what you want to do.");
    expect(markup).not.toContain('class="docs-index-item"');
  });

  it("maps documentation search shortcuts without stealing keys from other fields", () => {
    expect(docsSearchKeyAction({ key: "/", isTyping: false, isSearchFocused: false })).toBe("focus");
    expect(docsSearchKeyAction({ key: "/", isTyping: true, isSearchFocused: false })).toBeNull();
    expect(docsSearchKeyAction({ key: "Escape", isTyping: true, isSearchFocused: true })).toBe("clear");
    expect(docsSearchKeyAction({ key: "Escape", isTyping: false, isSearchFocused: false })).toBeNull();
  });

  it("keeps internal command and implementation language out of public documentation", async () => {
    const pages = await allDocs();
    const publicBodies = pages.map((page) => page.body).join("\n");

    expect(publicBodies).not.toMatch(/\((?:command|setting):/i);
    expect(publicBodies).not.toMatch(/Settings\s*→\s*adcode\.|CmdOrCtrl/i);
    expect(publicBodies).not.toMatch(/developer tools|internal adapters?|registration contract/i);
  });

  it("gives users availability guidance without operator rationale", async () => {
    const installation = await getDoc("installing-adcode");

    expect(installation?.body).toContain("macOS installs are not available yet.");
    expect(installation?.body).not.toMatch(
      /paid Apple Developer|notaris|notariz|code-sign|Mark of the Web|zone tag/i,
    );
  });

  it("publishes the docs index and feature guides in the sitemap", async () => {
    const locations = (await sitemap()).map((entry) => entry.url);

    expect(locations).toContainEqual(expect.stringMatching(/\/docs$/));
    expect(locations).toContainEqual(
      expect.stringMatching(/\/docs\/workbench-all-features$/),
    );
  });
});
