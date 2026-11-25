import { describe, expect, it, vi } from "vitest";
import { createBanWatch, isBanRefusal, requestUrl, sameOrigin, watchFetch, type AccountBanState, type Standing } from "../src/main/accountBanWatch.ts";
import { BAN_HEADER } from "../src/main/accountBanWatch.ts";
import { ACCOUNT_BANNED_COPY, appealMailto } from "../../../packages/help/src/accountBan.ts";
import { ACCOUNT_BANNED, ACCOUNT_HEADER, BANNED_MESSAGE, SUPPORT_EMAIL, bannedResponse } from "../../../services/api/src/accountBan.ts";

const API = "https://adcode.bluethenics.com";

describe("noticing a ban in any API answer", () => {
  it("recognises the API's refusal by its header, not a bare 403", () => {
    const refusal = bannedResponse();
    expect(isBanRefusal(refusal.status, refusal.headers)).toBe(true);
    expect(isBanRefusal(403, new Headers())).toBe(false);
    expect(isBanRefusal(200, new Headers({ [BAN_HEADER]: "banned" }))).toBe(false);
    expect(BAN_HEADER).toBe(ACCOUNT_BANNED_COPY.header);
  });

  it("reports a refusal from the API's origin only, and hands the response back untouched", async () => {
    const onBanned = vi.fn();
    const inner = vi.fn(async () => bannedResponse()) as unknown as typeof fetch;
    const watched = watchFetch(inner, sameOrigin(API), onBanned);
    const response = await watched(`${API}/v1/sponsored/earn`, { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "account-banned" });
    expect(onBanned).toHaveBeenCalledTimes(1);
    // A page this machine previews sending the header is not a ban.
    await watched("http://127.0.0.1:5173/anything");
    await watched("https://adcode.bluethenics.com.evil.example/v1/me");
    expect(onBanned).toHaveBeenCalledTimes(1);
    await watched(new Request(`${API}/v1/ai/tagflow/chat/completions`));
    expect(onBanned).toHaveBeenCalledTimes(2);
  });

  it("reads the URL from every form fetch takes", () => {
    expect(requestUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(requestUrl(new URL("https://a.test/y"))).toBe("https://a.test/y");
    expect(requestUrl(new Request("https://a.test/z"))).toBe("https://a.test/z");
    expect(requestUrl(42)).toBeNull();
  });
});

function harness() {
  let standing: Standing = "active", uid: string | null = "u-1", now = 1_000;
  const published: AccountBanState[] = [];
  const timers: Array<() => void> = [];
  const watch = createBanWatch({
    check: async () => standing,
    publish: (state) => published.push(state),
    uid: () => uid,
    now: () => now,
    later: (run) => { timers.push(run); return () => { const i = timers.indexOf(run); if (i >= 0) timers.splice(i, 1); }; },
  });
  return {
    watch, published, timers,
    set: (next: Standing) => { standing = next; },
    as: (next: string | null) => { uid = next; },
    tick: (ms: number) => { now += ms; },
  };
}

describe("the ban watch", () => {
  it("shows the ban the moment a refusal is seen, and only once", () => {
    const h = harness();
    h.watch.noteBanned();
    h.watch.noteBanned();
    expect(h.published).toEqual([{ banned: true, uid: "u-1", since: 1_000 }]);
    expect(h.timers).toHaveLength(1);
  });

  it("asks again while banned, and lifts the screen when the account is unbanned", async () => {
    const h = harness();
    h.set("banned");
    await h.watch.recheck();
    expect(h.watch.state().banned).toBe(true);
    expect(h.timers).toHaveLength(1);
    h.set("active");
    h.timers.shift()!();
    await vi.waitFor(() => expect(h.watch.state()).toEqual({ banned: false }));
    expect(h.published.map((s) => s.banned)).toEqual([true, false]);
    expect(h.timers).toHaveLength(0);
  });

  it("keeps the screen up when the server cannot be reached", async () => {
    const h = harness();
    h.watch.noteBanned();
    h.set("unknown");
    expect((await h.watch.recheck()).banned).toBe(true);
    expect(h.published).toHaveLength(1);
  });

  it("does not follow the person to a different account", async () => {
    const h = harness();
    h.watch.noteBanned();
    h.as("u-2");
    h.watch.accountChanged();
    await vi.waitFor(() => expect(h.watch.state()).toEqual({ banned: false }));
    // The same account again is still banned.
    h.as("u-1");
    h.watch.accountChanged();
    expect(h.watch.state().banned).toBe(false);
  });
});

describe("one set of words", () => {
  // The server cannot import a package (the dependency firewall), so the copy lives twice.
  it("tells the clients the same sentence, code and header the server sends", () => {
    expect(ACCOUNT_BANNED_COPY.message).toBe(BANNED_MESSAGE);
    expect(ACCOUNT_BANNED_COPY.support).toBe(SUPPORT_EMAIL);
    expect(ACCOUNT_BANNED_COPY.header).toBe(ACCOUNT_HEADER);
    expect(ACCOUNT_BANNED_COPY.code).toBe(ACCOUNT_BANNED);
  });
});

describe("the appeal", () => {
  it("writes to support with the account id and nothing secret", () => {
    const link = appealMailto("u-123");
    expect(link.startsWith("mailto:adcode.support@gmail.com?")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Account ID: u-123");
  });
});
