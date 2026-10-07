import { describe, expect, it } from "vitest";
import { inviteLine, inviteLink, parseInviteInput, parseInviteText } from "../src/shared/invite.ts";
import { createReferralClient, type ReferralLocalState } from "../src/main/referralClient.ts";

describe("what counts as an invite on the clipboard", () => {
  it.each([
    ["ADCode invite: k7p4qzm", "k7p4qzm"],
    ["  ADCode invite: K7P4QZM \n", "k7p4qzm"],
    ["https://adcode.bluethenics.com/i/k7p4qzm", "k7p4qzm"],
    ["https://adcode.bluethenics.com/i/k7p4qzm?from=readme", "k7p4qzm"],
    ["adcode.bluethenics.com/i/threads-oct06/", "threads-oct06"],
  ])("takes %j as %j", (text, code) => {
    expect(parseInviteText(text)).toBe(code);
  });

  it.each([
    "k7p4qzm", // a bare word on a clipboard is too likely to be something else
    "my password is k7p4qzm",
    "ADCode invite: k7p4qzm and more",
    "https://evil.example/i/k7p4qzm",
    "",
    "x".repeat(5000),
  ])("ignores %j", (text) => {
    expect(parseInviteText(text)).toBeNull();
  });
});

describe("what counts as an invite typed into the box", () => {
  it("also takes a bare code, because a person typed it on purpose", () => {
    expect(parseInviteInput(" K7P4QZM ")).toBe("k7p4qzm");
    expect(parseInviteInput("ADCode invite: k7p4qzm")).toBe("k7p4qzm");
    expect(parseInviteInput("not a code!")).toBeNull();
  });
});

describe("links and lines", () => {
  it("builds the link and the clipboard line the invite page writes", () => {
    expect(inviteLink("k7p4qzm")).toBe("https://adcode.bluethenics.com/i/k7p4qzm");
    expect(inviteLink("k7p4qzm", "readme")).toBe("https://adcode.bluethenics.com/i/k7p4qzm?from=readme");
    expect(inviteLine("k7p4qzm")).toBe("ADCode invite: k7p4qzm");
    expect(parseInviteText(inviteLine("k7p4qzm"))).toBe("k7p4qzm");
  });
});

function harness(options: { clipboard?: string; respond?: (path: string, body: unknown) => { status: number; body: unknown } } = {}) {
  let state: ReferralLocalState = { heldUids: [], tried: [], done: false };
  const requests: { path: string; method: string; body: unknown }[] = [];
  let clipboard = options.clipboard ?? "";
  let uid: string | null = "me";
  const respond = options.respond ?? ((path: string) => path === "/referrals"
    ? { status: 200, body: { code: "mine123", claimed: false, canClaim: true } }
    : { status: 200, body: { ok: true, inviterName: "Sam" } });
  const client = createReferralClient({
    apiBaseUrl: () => "https://api.test/v1",
    token: async () => "tok",
    currentUid: () => uid,
    readClipboard: () => clipboard,
    load: async () => structuredClone(state),
    save: async (next) => { state = structuredClone(next); },
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.test/v1", "");
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push({ path, method: init?.method ?? "GET", body });
      const reply = respond(path, body);
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }) as typeof fetch,
  });
  return { client, requests, state: () => state, setClipboard: (text: string) => { clipboard = text; }, setUid: (next: string | null) => { uid = next; } };
}

describe("the clipboard check", () => {
  it("claims an invite line and says who invited", async () => {
    const h = harness({ clipboard: "ADCode invite: k7p4qzm" });
    expect(await h.client.checkClipboard()).toEqual({ claimed: true, inviterName: "Sam" });
    expect(h.requests).toEqual([{ path: "/referrals/claim", method: "POST", body: { code: "k7p4qzm", how: "clipboard", heldUids: [] } }]);
    expect(h.state().done).toBe(true);
  });

  it("sends nothing at all when the clipboard holds anything else", async () => {
    const h = harness({ clipboard: "const secret = 'hunter2';" });
    expect(await h.client.checkClipboard()).toEqual({ claimed: false });
    expect(h.requests).toEqual([]);
  });

  it("tries a code once, not every time the screen opens", async () => {
    const h = harness({ clipboard: "ADCode invite: nope123", respond: () => ({ status: 409, body: { error: "unknown-code" } }) });
    await h.client.checkClipboard();
    await h.client.checkClipboard();
    expect(h.requests).toHaveLength(1);
    h.setClipboard("ADCode invite: k7p4qzm");
    await h.client.checkClipboard();
    expect(h.requests).toHaveLength(2);
  });

  it("stops checking for good once the account has a claim or is too old", async () => {
    for (const error of ["already-claimed", "too-late"]) {
      const h = harness({ clipboard: "ADCode invite: k7p4qzm", respond: () => ({ status: 409, body: { error } }) });
      expect(await h.client.checkClipboard()).toEqual({ claimed: false });
      expect(h.state().done).toBe(true);
      h.setClipboard("ADCode invite: other12");
      await h.client.checkClipboard();
      expect(h.requests).toHaveLength(1);
    }
  });

  it("tries again later when the network was down, rather than burning the code", async () => {
    let up = false;
    const h = harness({
      clipboard: "ADCode invite: k7p4qzm",
      respond: () => {
        if (!up) throw new Error("offline");
        return { status: 200, body: { ok: true, inviterName: null } };
      },
    });
    expect(await h.client.checkClipboard()).toEqual({ claimed: false });
    up = true;
    expect(await h.client.checkClipboard()).toEqual({ claimed: true, inviterName: null });
  });

  it("remembers every account this machine has held and sends the earlier ones", async () => {
    const h = harness({ clipboard: "ADCode invite: k7p4qzm" });
    await h.client.get(); // seen as "me"
    h.setUid("after-reset");
    await h.client.checkClipboard();
    expect(h.state().heldUids).toEqual(["me", "after-reset"]);
    expect(h.requests.at(-1)?.body).toEqual({ code: "k7p4qzm", how: "clipboard", heldUids: ["me"] });
  });

  it("does not send the current account as a held one", async () => {
    const h = harness({ clipboard: "ADCode invite: k7p4qzm" });
    await h.client.get(); // records "me"
    await h.client.checkClipboard();
    expect(h.requests.at(-1)?.body).toEqual({ code: "k7p4qzm", how: "clipboard", heldUids: [] });
  });
});

describe("the paste box", () => {
  it("claims what was typed, and explains a refusal in words", async () => {
    const h = harness({ respond: () => ({ status: 409, body: { error: "own-code" } }) });
    expect(await h.client.claim("k7p4qzm")).toEqual({ ok: false, error: "own-code" });
    expect(h.requests[0]?.body).toEqual({ code: "k7p4qzm", how: "paste", heldUids: [] });
    expect(await h.client.claim("not a code!")).toEqual({ ok: false, error: "invalid" });
    expect(h.requests).toHaveLength(1);
  });

  it("reports a missing table as unavailable, and a dead network as offline", async () => {
    expect(await harness({ respond: () => ({ status: 503, body: { error: "referrals-unavailable" } }) }).client.claim("k7p4qzm")).toEqual({ ok: false, error: "unavailable" });
    expect(await harness({ respond: () => { throw new Error("down"); } }).client.claim("k7p4qzm")).toEqual({ ok: false, error: "offline" });
  });
});

describe("reading your invite", () => {
  it("returns the server's view, and null when invites are unavailable", async () => {
    const view = { code: "k7p4qzm", claimed: false, canClaim: true };
    expect(await harness({ respond: () => ({ status: 200, body: view }) }).client.get()).toEqual(view);
    expect(await harness({ respond: () => ({ status: 503, body: {} }) }).client.get()).toBeNull();
  });

  it("stops clipboard checks once the server says this account cannot claim", async () => {
    const h = harness({ clipboard: "ADCode invite: k7p4qzm", respond: (path) => path === "/referrals"
      ? { status: 200, body: { code: "x", claimed: false, canClaim: false } }
      : { status: 200, body: { ok: true, inviterName: null } } });
    await h.client.get();
    expect(await h.client.checkClipboard()).toEqual({ claimed: false });
    expect(h.requests.map((r) => r.path)).toEqual(["/referrals"]);
  });

  it("saves the name switch", async () => {
    const h = harness({ respond: () => ({ status: 200, body: { showName: false } }) });
    expect(await h.client.setShowName(false)).toEqual({ showName: false });
    expect(h.requests[0]).toEqual({ path: "/referrals", method: "PATCH", body: { showName: false } });
  });
});
