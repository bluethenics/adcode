import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnlineAiCodeEditorPage, { metadata } from "../src/app/online-ai-code-editor/page";
import { GET as llmsIndex } from "../src/app/llms.txt/route";
import { GET as llmsFull } from "../src/app/llms-full.txt/route";
import sitemap from "../src/app/sitemap";
import { metadata as inviteMetadata } from "../src/app/invite/page";
import { webApplication } from "../src/lib/schema";
import { WEB_VERSION_URL, url } from "../src/lib/site";

afterEach(() => vi.unstubAllGlobals());

describe("browser app search discovery", () => {
  it("keeps the referral search snippet informative after sentence-aware trimming", () => {
    expect(inviteMetadata.description?.length).toBeGreaterThanOrEqual(70);
    expect(inviteMetadata.description?.length).toBeLessThanOrEqual(160);
  });

  it("serves a canonical guide with browser application data and visible answers", () => {
    expect(metadata.alternates?.canonical).toBe(url("/online-ai-code-editor"));
    const markup = renderToStaticMarkup(<OnlineAiCodeEditorPage />);
    expect(markup).toContain('"@type":"WebApplication"');
    expect(markup).toContain('"@type":"FAQPage"');
    expect(markup).toContain("no personal time quota");
    const app = webApplication();
    expect(app["@id"]).toBe(new URL("/#app", WEB_VERSION_URL).toString());
    expect(app["url"]).toBe(new URL("/", WEB_VERSION_URL).toString());
    expect(app["publisher"]).toEqual({ "@id": url("/#organization") });
  });

  it("lists the guide in sitemap and both machine-readable versions with current plan facts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline in tests")));
    const entries = await sitemap();
    expect(entries.some((entry) => entry.url === url("/online-ai-code-editor"))).toBe(true);
    for (const get of [llmsIndex, llmsFull]) {
      const response = await get();
      const text = await response.text();
      expect(text).toContain(url("/online-ai-code-editor"));
      expect(text).toContain(WEB_VERSION_URL);
      expect(text).toContain("Tagflow AI and all other included models share");
      expect(text).toContain("5M free tokens");
      expect(text).toContain(url("/pricing"));
    }
  });
});
