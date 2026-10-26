import { describe, expect, it } from "vitest";
import { fetchPublishedUpdate, newestPublishedVersion } from "../src/main/externalUpdates.ts";

describe("published update versions", () => {
  it("uses numeric version order and ignores betas, malformed or older versions", () => {
    expect(newestPublishedVersion(["2.9.0", "2.10.0", "2.11.0-beta.1", "garbage", "1.0.0"], "2.8.0")).toBe("2.10.0");
    expect(newestPublishedVersion(["2.4.0"], "2.4.0")).toBeNull();
    expect(newestPublishedVersion(["2.5.0"], "unknown")).toBeNull();
  });
  it("never announces a draft release", async () => {
    const fetchImpl = (async () => Response.json({ releases: [{ version: "2.5.0", title: "Draft", publishedAt: null }, { version: "2.4.0", title: "Current", publishedAt: 1 }] })) as typeof fetch;
    expect(await fetchPublishedUpdate("https://example.com/v1", "2.4.0", fetchImpl)).toBeNull();
  });
});
