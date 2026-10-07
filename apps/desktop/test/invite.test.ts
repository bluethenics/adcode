import { describe, expect, it } from "vitest";
import { SHARE_TEXT, advertiserPitch, collabInviteText, inviteLine, inviteLink, parseInviteInput, parseInviteText, shareUrl, withBuiltWithLine } from "../src/shared/invite.ts";
import { formatMicros, micros } from "@adcode/ads";
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

function harness(options: { clipboard?: string; open?: (url: string) => Promise<void>; respond?: (path: string, body: unknown) => { status: number; body: unknown } } = {}) {
  let state: ReferralLocalState = { heldUids: [], tried: [], done: false, buildShareOffered: false };
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
    format: (value) => formatMicros(micros(value)),
    openExternal: options.open ?? (async () => undefined),
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

  it("tries again later when the service has no invites yet, rather than burning the code", async () => {
    // A desktop release can reach people before the database migration: a 503 is not the code's fault.
    let live = false;
    const h = harness({
      clipboard: "ADCode invite: k7p4qzm",
      respond: () => (live ? { status: 200, body: { ok: true, inviterName: "Sam" } } : { status: 503, body: { error: "referrals-unavailable" } }),
    });
    expect(await h.client.checkClipboard()).toEqual({ claimed: false });
    expect(h.state().done).toBe(false);
    live = true;
    expect(await h.client.checkClipboard()).toEqual({ claimed: true, inviterName: "Sam" });
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
    const view = { code: "k7p4qzm", claimed: false, canClaim: true, earnedMicros: "0", last30Micros: "0" };
    expect(await harness({ respond: () => ({ status: 200, body: view }) }).client.get()).toEqual({ ...view, earnedLabel: "$0.00", last30Label: "$0.00" });
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
    const h = harness({ respond: () => ({ status: 200, body: { showName: false, earnedMicros: "0", last30Micros: "0" } }) });
    expect(await h.client.setShowName(false)).toMatchObject({ showName: false });
    expect(h.requests[0]).toEqual({ path: "/referrals", method: "PATCH", body: { showName: false } });
  });
});

describe("sharing", () => {
  it("builds each share target from the link, with the line people see", () => {
    const link = "https://adcode.bluethenics.com/i/k7p4qzm";
    expect(shareUrl("x", link)).toBe(`https://x.com/intent/post?text=${encodeURIComponent(`${SHARE_TEXT} ${link}`)}`);
    expect(shareUrl("threads", link)).toBe(`https://www.threads.com/intent/post?text=${encodeURIComponent(`${SHARE_TEXT} ${link}`)}`);
    expect(shareUrl("email", link)).toBe(
      `mailto:?subject=${encodeURIComponent("Try ADCode with me")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${link}`)}`,
    );
  });

  it("opens only a target it built from this account's own link", async () => {
    const opened: string[] = [];
    const h = harness({ open: async (url) => { opened.push(url); } });
    expect(await h.client.share("threads")).toBe(true);
    expect(opened).toEqual([shareUrl("threads", "https://adcode.bluethenics.com/i/mine123")]);
  });

  it("opens nothing when there is no link to share", async () => {
    const opened: string[] = [];
    const h = harness({ open: async (url) => { opened.push(url); }, respond: () => ({ status: 503, body: {} }) });
    expect(await h.client.share("x")).toBe(false);
    expect(opened).toEqual([]);
  });
});

describe("money labels", () => {
  it("formats the server's micros in main, so the renderer never does arithmetic on money", async () => {
    const h = harness({ respond: () => ({ status: 200, body: { code: "x", claimed: false, canClaim: true, earnedMicros: "4200", last30Micros: "1200" } }) });
    expect(await h.client.get()).toMatchObject({ earnedLabel: "$0.0042", last30Label: "$0.0012" });
  });
});

describe("Built with ADCode", () => {
  const link = "https://adcode.bluethenics.com/i/k7p4qzm?from=readme";

  it("adds one line to a README, or makes one, and never adds it twice", () => {
    expect(withBuiltWithLine(null, link)).toBe(`Built with [ADCode](${link})\n`);
    expect(withBuiltWithLine("# My app\n\nA thing.\n", link)).toBe(`# My app\n\nA thing.\n\nBuilt with [ADCode](${link})\n`);
    expect(withBuiltWithLine("# My app\r\n\r\nA thing.", link)).toBe(`# My app\r\n\r\nA thing.\r\n\r\nBuilt with [ADCode](${link})\r\n`);
    expect(withBuiltWithLine(`# My app\n\nBuilt with [ADCode](https://adcode.bluethenics.com/i/other12)\n`, link)).toBeNull();
  });
});

describe("a live session invite for someone without ADCode", () => {
  it("says how to install and how to join, in that order", () => {
    expect(collabInviteText("https://adcode.bluethenics.com/i/k7p4qzm", "ABCD-1234")).toBe(
      "Join my live coding session in ADCode.\n\n" +
      "1. Install ADCode (free): https://adcode.bluethenics.com/i/k7p4qzm\n" +
      "2. Open Live Session, choose Join, and paste: ABCD-1234",
    );
  });
});

describe("the build share moment", () => {
  it("offers once, and only after ADCode has built something", async () => {
    const h = harness();
    expect(await h.client.takeBuildShareMoment(null)).toBe(false);
    expect(await h.client.takeBuildShareMoment(1000)).toBe(true);
    expect(await h.client.takeBuildShareMoment(1000)).toBe(false);
    expect(h.state().buildShareOffered).toBe(true);
  });
});

describe("the pitch for a company", () => {
  it("says what ADCode is and what it costs, with only published facts, and the advertiser link", () => {
    const pitch = advertiserPitch("https://adcode.bluethenics.com/i/k7p4qzm?for=ads");
    expect(pitch).toContain("ADCode");
    expect(pitch).toContain("$1 per 500 verified views");
    expect(pitch).toContain("https://adcode.bluethenics.com/i/k7p4qzm?for=ads");
    // No invented reach figures: nothing that looks like a user count.
    expect(pitch).not.toMatch(/\d[\d,]*\s+(developers|users|people)/);
  });
});
