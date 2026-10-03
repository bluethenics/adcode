import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { MILESTONES, parseMilestones } from "../src/milestones.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 3, 12);

describe("reading a milestone flush", () => {
  it("accepts names from the list with a time", () => {
    expect(parseMilestones({ milestones: [{ name: "welcome_shown", at: NOW }, { name: "turn_ok", at: NOW + 1 }] }))
      .toEqual([{ name: "welcome_shown", at: NOW }, { name: "turn_ok", at: NOW + 1 }]);
  });

  it("refuses anything that could carry more than a fixed word", () => {
    expect(parseMilestones({ milestones: [{ name: "prompt: build a bank", at: NOW }] })).toBeNull();
    expect(parseMilestones({ milestones: [{ name: "turn_ok", at: NOW, text: "secret" }] })).toEqual([{ name: "turn_ok", at: NOW }]);
    expect(parseMilestones({ milestones: [{ name: "turn_ok", at: "now" }] })).toBeNull();
    expect(parseMilestones({ milestones: [] })).toBeNull();
    expect(parseMilestones({ milestones: Array.from({ length: 41 }, () => ({ name: "turn_ok", at: NOW })) })).toBeNull();
    expect(parseMilestones(null)).toBeNull();
  });
});

describe("the milestones route", () => {
  function setup() {
    const store = createMemoryStore();
    const handler = createFetchHandler({
      store,
      clock: { now: () => NOW },
      verifier: {
        async verify(token) {
          if (token === "owner") return { uid: "owner", claims: { email: "owner@site.test", email_verified: true } };
          return token === "user" ? { uid: "user", claims: {} } : null;
        },
      },
    });
    const post = (body: unknown, token = "user") =>
      handler(new Request("https://site.test/v1/milestones", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
    const growth = async () => {
      await store.addAdmin({ email: "owner@site.test", addedBy: "setup", addedAt: 0 });
      const response = await handler(new Request("https://site.test/v1/admin/growth", { headers: { authorization: "Bearer owner" } }));
      return (await response.json()) as { developers: number; funnel: { base: number; steps: { name: string; accounts: number }[] } };
    };
    return { post, growth };
  }

  it("records a first session, and that makes the account a developer", async () => {
    const { post, growth } = setup();
    expect((await post({ milestones: [{ name: "welcome_shown", at: NOW - 60_000 }, { name: "prompt_sent", at: NOW }] })).status).toBe(200);

    const stats = await growth();
    expect(stats.developers).toBe(1);
    expect(stats.funnel.base).toBe(1);
    expect(stats.funnel.steps.find((step) => step.name === "prompt_sent")?.accounts).toBe(1);
    expect(stats.funnel.steps.find((step) => step.name === "turn_ok")?.accounts).toBe(0);
  });

  it("refuses a name it does not know", async () => {
    const { post } = setup();
    expect((await post({ milestones: [{ name: "keystrokes", at: NOW }] })).status).toBe(400);
  });

  it("needs a signed-in editor", async () => {
    const { post } = setup();
    expect((await post({ milestones: [{ name: "turn_ok", at: NOW }] }, "nobody")).status).toBe(401);
  });

  it("keeps a wrong clock out of next year and out of 1970", async () => {
    const { post, growth } = setup();
    await post({ milestones: [{ name: "welcome_shown", at: NOW + 365 * DAY }, { name: "turn_ok", at: 1 }] });
    const stats = await growth();
    // Both were clamped into the last week, so both count for this month's funnel.
    expect(stats.funnel.steps.find((step) => step.name === "welcome_shown")?.accounts).toBe(1);
    expect(stats.funnel.steps.find((step) => step.name === "turn_ok")?.accounts).toBe(1);
  });
});

describe("the desktop app's copy of the list", () => {
  it("names exactly the milestones the service accepts", () => {
    const source = readFileSync(new URL("../../../apps/desktop/src/shared/milestones.ts", import.meta.url), "utf8");
    const listed = [...source.matchAll(/^\s*"([a-z_]+)",\r?$/gm)].map((match) => match[1]);
    expect(listed).toEqual([...MILESTONES]);
  });
});
