import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected away from documentation");
  },
  usePathname: () => "/docs/workbench-all-features",
}));

import DocsIndex from "../src/app/docs/page";
import { Nav } from "../src/components/Nav";

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
    const render = async (): Promise<string> => {
      const stream = await renderToReadableStream(await DocsIndex());
      return new Response(stream).text();
    };
    await expect(render()).resolves.toContain("Every feature, explained");
    const markup = await render();

    expect(markup).toContain('href="/docs/workbench-all-features"');
    expect(markup).toContain("All Features");
    expect(markup).toContain("adcode open");
  });
});
