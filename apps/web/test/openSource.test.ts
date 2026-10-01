import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAQ } from "../src/lib/schema";
import { SOURCE } from "../src/lib/site";
import { GET as llms } from "../src/app/llms.txt/route";
import { GET as llmsFull } from "../src/app/llms-full.txt/route";

const read = (relative: string): string =>
  readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");

describe("the site says ADCode is open source", () => {
  it("keeps the facts in one place", () => {
    expect(SOURCE).toEqual({
      repo: "https://github.com/bluethenics/adcode",
      licence: "Apache-2.0",
      licenceUrl: "https://github.com/bluethenics/adcode/blob/main/LICENSE",
    });
  });

  it("links to the source from the footer, from the shared constant", () => {
    const footer = read("components/Footer.tsx");
    expect(footer).toContain("SOURCE.repo");
    expect(footer).toContain("SOURCE.licence");
    expect(footer).toContain("Source code");
  });

  it("answers the question in the FAQ", () => {
    const item = FAQ.find((one) => /open source/i.test(one.q));
    expect(item).toBeDefined();
    expect(item!.a).toContain("Apache License 2.0");
    expect(item!.a).toContain("github.com/bluethenics/adcode");
  });

  it("tells language models too, in both files", async () => {
    for (const route of [llms, llmsFull]) {
      const text = await (await route()).text();
      expect(text).toContain("Apache-2.0");
      expect(text).toContain(SOURCE.repo);
    }
  });
});

describe("the terms no longer contradict the licence", () => {
  const terms = read("app/terms/page.tsx");

  it("says the source code is governed by Apache-2.0", () => {
    expect(terms).toContain("Apache License 2.0");
  });

  it("does not claim a revocable licence or forbid resale of the code", () => {
    expect(terms).not.toContain("revocable licence");
    expect(terms).not.toContain("resell or sublicense the editor");
  });

  it("keeps the rules that protect the service", () => {
    expect(terms).toContain("as though it were official");
    expect(terms).toContain("record receipts");
  });
});
