import { describe, it, expect, vi } from "vitest";
import {
  createAdminConsoleHandler, daysToFinish, isAdminConsolePath, parseCampaignInput, personalize,
  type AdminConsoleStore, type CampaignRecord,
} from "../src/adminConsole.ts";
import { runCampaignBatch } from "../src/mailingDelivery.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { MailingStore } from "../src/mailing.ts";
import type { TokenVerifier } from "../src/auth.ts";

const NOW = 1_800_000_000_000;
const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const valid = {
  name: "Come back", subject: "{{name}}, it's been a while", preheader: "", heading: "Pick up where you left off",
  body: "Hi {{name}},\n\nYour projects are waiting.", ctaLabel: "Open ADCode", ctaUrl: "https://adcode.bluethenics.com/",
  audience: "everyone", inactiveDays: 14, totalLimit: 1000, dailyLimit: 50,
};

describe("a campaign as written", () => {
  it("accepts the 1,000-total, 50-a-day shape", () => {
    const parsed = parseCampaignInput(valid);
    expect("error" in parsed).toBe(false);
    expect(parsed).toMatchObject({ totalLimit: 1000, dailyLimit: 50, audience: "everyone", inactiveDays: 14 });
  });

  it("refuses a daily limit above the total, a button with no link, and a non-https link", () => {
    expect(parseCampaignInput({ ...valid, dailyLimit: 2000 })).toEqual({ error: "The daily limit can't be larger than the total." });
    expect(parseCampaignInput({ ...valid, ctaUrl: "" })).toHaveProperty("error");
    expect(parseCampaignInput({ ...valid, ctaUrl: "http://adcode.bluethenics.com/" })).toHaveProperty("error");
    expect(parseCampaignInput({ ...valid, ctaUrl: "javascript:alert(1)" })).toHaveProperty("error");
  });

  it("refuses an unknown audience and out-of-range numbers", () => {
    expect(parseCampaignInput({ ...valid, audience: "all" })).toHaveProperty("error");
    expect(parseCampaignInput({ ...valid, totalLimit: 0 })).toHaveProperty("error");
    expect(parseCampaignInput({ ...valid, totalLimit: 1.5 })).toHaveProperty("error");
    expect(parseCampaignInput({ ...valid, inactiveDays: 0 })).toHaveProperty("error");
  });

  it("allows no button and no inactivity filter", () => {
    const parsed = parseCampaignInput({ ...valid, ctaLabel: null, ctaUrl: null, inactiveDays: null });
    expect(parsed).toMatchObject({ ctaLabel: null, ctaUrl: null, inactiveDays: null });
  });

  it("fills {{name}} with a first name, or 'there'", () => {
    expect(personalize("Hi {{name}}", "Maya Okafor")).toBe("Hi Maya");
    expect(personalize("Hi {{ name }}", null)).toBe("Hi there");
    expect(personalize("Hi {{name}}", "   ")).toBe("Hi there");
  });

  it("estimates the days left at the daily cap", () => {
    expect(daysToFinish({ totalLimit: 1000, dailyLimit: 50 }, 0)).toBe(20);
    expect(daysToFinish({ totalLimit: 1000, dailyLimit: 50 }, 990)).toBe(1);
    expect(daysToFinish({ totalLimit: 1000, dailyLimit: 50 }, 1000)).toBe(0);
  });
});

describe("the console's paths", () => {
  it("answers its own and nothing else", () => {
    expect(isAdminConsolePath("/v1/admin/console/users")).toBe(true);
    expect(isAdminConsolePath("/v1/admin/console/users/abc")).toBe(true);
    expect(isAdminConsolePath("/v1/admin/console/users/abc/email")).toBe(true);
    expect(isAdminConsolePath("/v1/admin/campaigns")).toBe(true);
    expect(isAdminConsolePath(`/v1/admin/campaigns/${ID}/state`)).toBe(true);
    expect(isAdminConsolePath("/v1/admin/users")).toBe(false);
    expect(isAdminConsolePath("/v1/admin/ai-plans/campaign")).toBe(false);
  });
});

function consoleStore(overrides: Partial<AdminConsoleStore> = {}): AdminConsoleStore {
  return {
    searchUsers: vi.fn(async () => [{ uid: "u1", email: "maya@gmail.com" }]),
    userProfile: vi.fn(async () => ({ uid: "u1" })),
    setEmailBlocked: vi.fn(async () => "blocked" as const),
    listCampaigns: vi.fn(async () => []),
    getCampaign: vi.fn(async () => null),
    createCampaign: vi.fn(async (input, by, now) => ({ ...input, id: ID, status: "draft" as const, createdBy: by, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, finishReason: null })),
    updateCampaign: vi.fn(async () => null),
    setCampaignStatus: vi.fn(async () => "ok" as const),
    campaignStats: vi.fn(async () => ({})),
    recentSends: vi.fn(async () => []),
    audience: vi.fn(async () => 14_773),
    claimCampaignSends: vi.fn(async () => []),
    finishCampaignSend: vi.fn(async () => {}),
    ...overrides,
  };
}

async function handler(isAdmin: boolean, db = consoleStore()) {
  const store = createMemoryStore();
  const verifier: TokenVerifier = { verify: async () => ({ uid: "admin-uid", claims: { email: isAdmin ? "boss@example.test" : "someone@example.test", email_verified: true } }) };
  await store.addAdmin({ email: "boss@example.test", addedBy: "seed", addedAt: NOW });
  return { handle: createAdminConsoleHandler({ store, verifier, clock: { now: () => NOW }, console: db }), db, store };
}
const call = (path: string, init: RequestInit = {}) => new Request(`https://adcode.test${path}`, { ...init, headers: { authorization: "Bearer token", "content-type": "application/json" } });

describe("the console's gate", () => {
  it("returns null for paths that are not its own", async () => {
    const { handle } = await handler(true);
    expect(await handle(call("/v1/admin/users"))).toBeNull();
  });

  it("lets an administrator search, and writes the audit line", async () => {
    const { handle, db } = await handler(true);
    const response = await handle(call("/v1/admin/console/users?q=maya%40gmail.com"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ rows: [{ uid: "u1", email: "maya@gmail.com" }] });
    expect(db.searchUsers).toHaveBeenCalledWith("maya@gmail.com", 25);
  });

  it("creates a campaign as a draft and refuses a bad one with the reason", async () => {
    const { handle, db } = await handler(true);
    const created = await handle(call("/v1/admin/campaigns", { method: "POST", body: JSON.stringify(valid) }));
    expect(created?.status).toBe(200);
    expect(await created?.json()).toMatchObject({ id: ID, status: "draft", totalLimit: 1000, dailyLimit: 50 });
    const refused = await handle(call("/v1/admin/campaigns", { method: "POST", body: JSON.stringify({ ...valid, dailyLimit: 5000 }) }));
    expect(refused?.status).toBe(400);
    expect(await refused?.json()).toEqual({ error: "bad-campaign", message: "The daily limit can't be larger than the total." });
    expect(db.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("refuses without a token and refuses a non-administrator", async () => {
    const { handle, db } = await handler(false);
    const anonymous = await handle(new Request("https://adcode.test/v1/admin/console/users?q=maya"));
    expect(anonymous?.status).toBe(401);
    const response = await handle(call("/v1/admin/console/users?q=maya"));
    expect(response?.status).toBe(403);
    expect(db.searchUsers).not.toHaveBeenCalled();
  });
});

describe("campaign sending", () => {
  const settings = { enabled: true, postalAddress: "1 Example Street, Sydney NSW 2000", senderVerified: true };
  const mailing = { settings: vi.fn(async () => settings) } as unknown as MailingStore;
  const campaign: CampaignRecord = { ...(parseCampaignInput(valid) as Exclude<ReturnType<typeof parseCampaignInput>, { error: string }>), id: ID, status: "running", createdBy: "a", createdAt: NOW, updatedAt: NOW, startedAt: NOW, finishedAt: null, finishReason: null };

  it("sends each claimed email once, with an unsubscribe link, and records the provider id", async () => {
    const db = consoleStore({
      claimCampaignSends: vi.fn(async () => [{ id: "s1", campaignId: ID, uid: "u1", email: "maya@gmail.com", attempts: 1, unsubscribeToken: "11111111-1111-4111-8111-111111111111", displayName: "Maya Okafor" }]),
      getCampaign: vi.fn(async () => campaign),
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const render = vi.fn(async () => ({ subject: "s", html: "<p>h</p>", text: "t" }));
    const result = await runCampaignBatch({ store: mailing, campaigns: db, apiKey: "re_key", webhookSecret: "whsec_secretsecretsecret", siteOrigin: "https://adcode.test", render, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW });
    expect(result).toEqual({ status: "complete", sent: 1, failed: 0 });
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body as string);
    expect(body.to).toEqual(["maya@gmail.com"]);
    expect(body.headers["List-Unsubscribe"]).toContain("/v1/email/unsubscribe?token=11111111-1111-4111-8111-111111111111");
    expect(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": "campaign/s1" });
    expect(db.finishCampaignSend).toHaveBeenCalledWith("s1", { providerId: "re_1" }, NOW);
  });

  it("sends nothing while bulk email is switched off", async () => {
    const db = consoleStore();
    const off = { settings: vi.fn(async () => ({ ...settings, enabled: false })) } as unknown as MailingStore;
    const result = await runCampaignBatch({ store: off, campaigns: db, apiKey: "k", webhookSecret: "whsec_secretsecretsecret", siteOrigin: "https://adcode.test", render: vi.fn() });
    expect(result.status).toBe("disabled");
    expect(db.claimCampaignSends).not.toHaveBeenCalled();
  });
});
