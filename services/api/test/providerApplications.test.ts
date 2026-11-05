import { describe, expect, it } from "vitest";
import { isApplicationStatus, parseProviderApplication } from "../src/providerApplications.ts";

const valid = {
  company: "Nimbus AI", contactName: "Ana Ruiz", email: "Ana@Nimbus.ai", website: "https://nimbus.ai",
  models: "nimbus-coder-32b\nnimbus-fast-8b", apiBase: "https://api.nimbus.ai/v1", offers: ["free", "byok"], pricing: "$0.20 / $0.60 per 1M", message: "Happy to sponsor a month.", url2: "",
};

describe("model provider applications", () => {
  it("accepts a complete application and tidies it", () => {
    const result = parseProviderApplication(valid);
    expect(result).toMatchObject({ ok: true, value: { email: "ana@nimbus.ai", models: ["nimbus-coder-32b", "nimbus-fast-8b"], offers: ["free", "byok"] } });
  });

  it("needs only the essentials", () => {
    expect(parseProviderApplication({ company: "X Labs", contactName: "Bo", email: "bo@x.dev", website: "https://x.dev", models: "x-1", offers: ["paid"] }).ok).toBe(true);
  });

  it("says what is missing in words the form can show", () => {
    expect(parseProviderApplication({ ...valid, email: "nope" })).toEqual({ ok: false, error: "Add a work email we can reply to." });
    expect(parseProviderApplication({ ...valid, website: "http://nimbus.ai" })).toMatchObject({ ok: false });
    expect(parseProviderApplication({ ...valid, models: "  " })).toEqual({ ok: false, error: "List at least one model, one per line." });
    expect(parseProviderApplication({ ...valid, offers: [] })).toMatchObject({ ok: false });
    expect(parseProviderApplication({ ...valid, apiBase: "ftp://x" })).toMatchObject({ ok: false });
  });

  it("refuses unknown fields and catches the honeypot", () => {
    expect(parseProviderApplication({ ...valid, admin: true })).toMatchObject({ ok: false });
    expect(parseProviderApplication({ ...valid, url2: "https://spam.example" })).toMatchObject({ ok: false, bot: true });
  });

  it("knows the review statuses", () => {
    expect(isApplicationStatus("accepted")).toBe(true);
    expect(isApplicationStatus("deleted")).toBe(false);
  });
});
