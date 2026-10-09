import { describe, expect, it } from "vitest";
import { effectiveProvider, impliedProvider, partnerNoteSegments, partnerOf } from "../src/shared/tagflow.ts";

/**
 * Which provider a person is on before they have chosen one.
 *
 * Asked for: Tag Flow AI's models "already connected" so a new user can "just go and
 * straight up use the AI". A fresh install starts on Tag Flow. Somebody who saved an
 * Anthropic key back when Anthropic was the silent default keeps it, and when the admin
 * panel switches Tag Flow off, a fresh install starts where it used to.
 */
describe("impliedProvider", () => {
  it("starts a fresh install on Tag Flow AI", () => {
    expect(impliedProvider({ anthropicKeySaved: false, tagflowEnabled: true })).toBe("tagflow");
  });

  it("keeps somebody who saved an Anthropic key under the old default", () => {
    expect(impliedProvider({ anthropicKeySaved: true, tagflowEnabled: true })).toBe("anthropic");
  });

  it("falls back to the old default while Tag Flow is switched off", () => {
    expect(impliedProvider({ anthropicKeySaved: false, tagflowEnabled: false })).toBe("anthropic");
  });
});

describe("partnerOf", () => {
  it("names Tag Flow and links its privacy policy and terms", () => {
    expect(partnerOf({ privacyUrl: "https://tagflow-ai.com/legal/privacy", termsUrl: "https://tagflow-ai.com/legal/terms" })).toEqual({
      name: "Tag Flow AI",
      privacyUrl: "https://tagflow-ai.com/legal/privacy",
      termsUrl: "https://tagflow-ai.com/legal/terms",
    });
  });

  it("links Tag Flow's site for its terms until it publishes a terms page", () => {
    expect(partnerOf({ privacyUrl: "https://tagflow-ai.com/legal/privacy", termsUrl: null }).termsUrl).toBe("https://tagflow-ai.com");
  });
});

describe("partnerNoteSegments", () => {
  it("says whose terms apply and links both documents", () => {
    const partner = { name: "Tag Flow AI", privacyUrl: "https://tagflow-ai.com/legal/privacy", termsUrl: "https://tagflow-ai.com" };
    const segments = partnerNoteSegments(partner);
    expect(segments.map((one) => one.text).join("")).toBe("Tag Flow AI is an ADCode partner. Their Privacy Policy and Terms apply when you use their models.");
    expect(segments.filter((one) => "href" in one)).toEqual([
      { text: "Privacy Policy", href: "https://tagflow-ai.com/legal/privacy" },
      { text: "Terms", href: "https://tagflow-ai.com" },
    ]);
  });
});

/**
 * The whole rule, with the stored setting. "anthropic" is what every install stored as the old
 * default, so it counts as a choice only with an Anthropic key behind it. While the keychain has
 * not answered yet, nothing moves to Tag Flow: sending somebody's code to a third party they
 * did not choose, even once, is worse than a moment of "not connected".
 */
describe("effectiveProvider", () => {
  it.each([
    ["a fresh install", "", false, true, "tagflow"],
    ["the stored old default with no Anthropic key", "anthropic", false, true, "tagflow"],
    ["the stored old default with an Anthropic key", "anthropic", true, true, "anthropic"],
    ["any other choice", "openai", false, true, "openai"],
    ["Tag Flow chosen outright", "tagflow", null, true, "tagflow"],
    ["Tag Flow switched off", "", false, false, "anthropic"],
    ["the keychain not answered yet, old default stored", "anthropic", null, true, "anthropic"],
    ["the keychain not answered yet, nothing stored", "", null, true, "anthropic"],
  ] as const)("%s", (_label, stored, anthropicKeySaved, tagflowEnabled, expected) => {
    expect(effectiveProvider({ stored, anthropicKeySaved, tagflowEnabled })).toBe(expected);
  });
});
