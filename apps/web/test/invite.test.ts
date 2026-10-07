import { describe, expect, it } from "vitest";
import {
  REF_KEY,
  REF_TTL_MS,
  campaignFor,
  clearRef,
  inviteHeadline,
  inviteLine,
  isInviteCode,
  readRef,
  rememberRef,
  refForSignup,
  invitePeopleLine,
  inviteTerms,
  inviteShareLinks,
} from "@/lib/invite";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe("invite codes on the site", () => {
  it("knows a code's shape", () => {
    expect(isInviteCode("k7p4qzm")).toBe(true);
    expect(isInviteCode("threads-oct06")).toBe(true);
    expect(isInviteCode("K7P4QZM")).toBe(false);
    expect(isInviteCode("ab")).toBe(false);
    expect(isInviteCode("../admin")).toBe(false);
  });

  it("writes exactly the line the editor looks for", () => {
    expect(inviteLine("k7p4qzm")).toBe("ADCode invite: k7p4qzm");
  });
});

describe("remembering the invite for sign-in and the portal", () => {
  it("keeps a code for 30 days, then forgets it", () => {
    const storage = memoryStorage();
    rememberRef(storage, "k7p4qzm", 1000);
    expect(readRef(storage, 1000 + REF_TTL_MS - 1)).toBe("k7p4qzm");
    expect(readRef(storage, 1000 + REF_TTL_MS)).toBeNull();
  });

  it("ignores junk and forgets on request", () => {
    const storage = memoryStorage();
    storage.setItem(REF_KEY, "not json");
    expect(readRef(storage, 0)).toBeNull();
    storage.setItem(REF_KEY, JSON.stringify({ code: "../x", at: 0 }));
    expect(readRef(storage, 0)).toBeNull();
    rememberRef(storage, "k7p4qzm", 0);
    clearRef(storage);
    expect(readRef(storage, 0)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(() => rememberRef(broken, "k7p4qzm", 0)).not.toThrow();
    expect(readRef(broken, 0)).toBeNull();
    expect(() => clearRef(broken)).not.toThrow();
  });
});

describe("which campaign a visit belongs to", () => {
  it("counts an invite page visit for its code, and leaves other pages to utm", () => {
    expect(campaignFor("/i/k7p4qzm", "")).toBe("ref.k7p4qzm");
    expect(campaignFor("/i/threads-oct06/", "")).toBe("ref.threads-oct06");
    expect(campaignFor("/i/k7p4qzm", "launch")).toBe("launch");
    expect(campaignFor("/versions", "launch")).toBe("launch");
    expect(campaignFor("/i/NOT_OK", "")).toBe("");
  });
});

describe("the invite page's headline", () => {
  it("names the inviter only when the lookup says it may", () => {
    expect(inviteHeadline({ valid: true, inviterName: "Sam", kind: "user" })).toBe("Sam invited you to ADCode");
    expect(inviteHeadline({ valid: true, inviterName: null, kind: "user" })).toBe("A developer invited you to ADCode");
    expect(inviteHeadline({ valid: true, inviterName: null, kind: "campaign" })).toBe("You're invited to ADCode");
    expect(inviteHeadline({ valid: false, inviterName: null, kind: null })).toBeNull();
    expect(inviteHeadline(null)).toBeNull();
  });
});

describe("the ref an advertiser signs up with", () => {
  it("prefers a ?ref= on the page, then the remembered invite", () => {
    const storage = memoryStorage();
    expect(refForSignup("?ref=K7P4QZM", storage, 0)).toBe("k7p4qzm");
    expect(refForSignup("", storage, 0)).toBeNull();
    rememberRef(storage, "threads-oct06", 0);
    expect(refForSignup("", storage, 1)).toBe("threads-oct06");
    expect(refForSignup("?ref=../bad", storage, 1)).toBe("threads-oct06");
  });
});

describe("the dashboard's invite words", () => {
  const base = { people: { claimed: 0, seen: 0, cameBack: 0 }, advertisers: 0 };
  it("leads with people", () => {
    expect(invitePeopleLine(base)).toBe("Nobody has used your link yet.");
    expect(invitePeopleLine({ people: { claimed: 2, seen: 1, cameBack: 0 }, advertisers: 1 }))
      .toBe("2 people joined with your link · 1 is using ADCode · 1 advertiser");
  });

  it("states the live terms", () => {
    expect(inviteTerms({ userPercent: 10, advertiserPercent: 5, windowDays: 365 })).toEqual([
      "You get 10% of what ADCode earns from the ads the people you invite see, for a year.",
      "Bring an advertiser and you get 5% of what they spend.",
      "It comes out of ADCode's half. The people you invite keep every cent of theirs.",
    ]);
  });

  it("shares with the same line the editor uses", () => {
    const link = "https://adcode.bluethenics.com/i/k7p4qzm";
    expect(inviteShareLinks(link)).toEqual({
      x: `https://x.com/intent/post?text=${encodeURIComponent(`I code in ADCode - the AI is free and the ads pay me. Here's my invite: ${link}`)}`,
      threads: `https://www.threads.com/intent/post?text=${encodeURIComponent(`I code in ADCode - the AI is free and the ads pay me. Here's my invite: ${link}`)}`,
      email: `mailto:?subject=${encodeURIComponent("Try ADCode with me")}&body=${encodeURIComponent(`I code in ADCode - the AI is free and the ads pay me. Here's my invite:\n\n${link}`)}`,
    });
  });
});
