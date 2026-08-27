import { describe, it, expect } from "vitest";
import { tag } from "@adcode/ads";
import { buildAdSignals, themeKindOf } from "../src/renderer/ads/adSignals.ts";

/**
 * The renderer half of `IdeSignals`.
 *
 * Worth its own file because the failure it guards is invisible everywhere else: the ad
 * package's own suite fakes this port, so an editor that answers it with nothing passes
 * every test in `packages/ads` while shipping untargeted ads and the wrong-colour logo.
 * The last block here closes that gap by running the real tagger over what this builds.
 */
describe("themeKindOf", () => {
  it("collapses three themes into the two an advertiser has artwork for", () => {
    expect(themeKindOf("light")).toBe("light");
    expect(themeKindOf("dark")).toBe("dark");
    // Midnight is a dark theme. There is no third logo to choose.
    expect(themeKindOf("midnight")).toBe("dark");
  });
});

describe("buildAdSignals", () => {
  it("reports the languages of the open editors", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["main.ts", "app.tsx", "server.py"],
      rootFileNames: [],
    });

    expect(signals.languageIds).toContain("typescript");
    expect(signals.languageIds).toContain("python");
  });

  it("does not repeat a language across two files of the same kind", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["a.ts", "b.ts", "c.ts"],
      rootFileNames: [],
    });

    expect(signals.languageIds).toEqual(["typescript"]);
  });

  it("drops plaintext, which maps to no tag and buys nothing on the wire", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["notes.somethingnobodyhas"],
      rootFileNames: [],
    });

    expect(signals.languageIds).toEqual([]);
  });

  it("carries the root manifests, which are where framework tags come from", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["index.ts"],
      rootFileNames: ["package.json", "next.config.ts"],
    });

    expect(signals.filenames).toContain("package.json");
    expect(signals.filenames).toContain("next.config.ts");
  });

  it("sends a name once, however many places it came from", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["package.json"],
      rootFileNames: ["package.json"],
    });

    expect(signals.filenames.filter((n) => n === "package.json")).toHaveLength(1);
  });

  /**
   * §8.2's rule, enforced on this side of the IPC boundary as well as inside the tagger.
   * The wrong place to first notice a leaked directory name is on the far side.
   */
  it("reduces anything path-shaped to a basename", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: ["E:/secret-client-project/src/main.ts"],
      rootFileNames: ["C:\\Users\\someone\\work\\package.json"],
    });

    expect(signals.filenames).toEqual(["main.ts", "package.json"]);
    for (const name of signals.filenames) {
      expect(name).not.toMatch(/[\\/]/);
    }
  });

  it("caps the list, so a pathological root cannot push a huge message per tab switch", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: [],
      rootFileNames: Array.from({ length: 500 }, (_, i) => `file-${i}.ts`),
    });

    expect(signals.filenames.length).toBeLessThanOrEqual(64);
  });

  it("survives a caller that hands it something that is not a string", () => {
    const signals = buildAdSignals({
      theme: "dark",
      openNames: [undefined as unknown as string, "main.rs"],
      rootFileNames: [null as unknown as string, "Cargo.toml"],
    });

    expect(signals.filenames).toEqual(["main.rs", "Cargo.toml"]);
  });

  /**
   * The whole point, end to end: a real workspace description through the real tagger.
   *
   * Before this wiring existed both inputs were permanently empty, so this produced `[]`
   * and every `/v1/serve` request went out with no targeting at all.
   */
  it("produces real vocabulary tags for a real-looking workspace", () => {
    const signals = buildAdSignals({
      theme: "light",
      openNames: ["page.tsx", "route.ts"],
      rootFileNames: ["package.json", "next.config.ts", "Dockerfile"],
    });

    const tags = tag({ languageIds: signals.languageIds, filenames: signals.filenames });

    expect(tags).toContain("lang:typescript");
    expect(tags).toContain("tool:npm");
    expect(tags).toContain("fw:next");
    expect(tags).toContain("tool:docker");
    expect(signals.themeKind).toBe("light");
  });

  it("still yields nothing for an editor with nothing open and no folder", () => {
    const signals = buildAdSignals({ theme: "dark", openNames: [], rootFileNames: [] });

    expect(tag({ languageIds: signals.languageIds, filenames: signals.filenames })).toEqual([]);
  });
});
