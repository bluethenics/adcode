import { describe, expect, it } from "vitest";
import type { ReferralView } from "../src/shared/api.ts";
import { claimMessage, earnedLine, howItWorks, invitedLine, namePreview, peopleLine } from "../src/renderer/invite/inviteModel.ts";

const view = (overrides: Partial<ReferralView> = {}): ReferralView => ({
  code: "k7p4qzm",
  link: "https://adcode.bluethenics.com/i/k7p4qzm",
  showName: true,
  inviterPreview: "Sam invited you to ADCode",
  claimed: false,
  invitedBy: null,
  canClaim: true,
  claimEndsAt: 0,
  people: { claimed: 0, seen: 0, cameBack: 0 },
  advertisers: 0,
  earnedMicros: "0",
  last30Micros: "0",
  earnedLabel: "$0.00",
  last30Label: "$0.00",
  rates: { userPercent: 10, advertiserPercent: 5, windowDays: 365 },
  ...overrides,
});

describe("who joined, in words", () => {
  it("leads with people, and says plainly when there is nobody yet", () => {
    expect(peopleLine(view())).toBe("Nobody has used your link yet.");
    expect(peopleLine(view({ people: { claimed: 3, seen: 2, cameBack: 1 }, advertisers: 1 })))
      .toBe("3 people joined with your link · 2 are using ADCode · 1 advertiser");
    expect(peopleLine(view({ people: { claimed: 1, seen: 1, cameBack: 0 } }))).toBe("1 person joined with your link · 1 is using ADCode");
    expect(peopleLine(view({ advertisers: 2 }))).toBe("2 advertisers joined with your link");
  });
});

describe("what it earned", () => {
  it("shows the exact amount, never a rounded zero, and nothing before there is any", () => {
    expect(earnedLine(view())).toBeNull();
    expect(earnedLine(view({ earnedMicros: "4200", earnedLabel: "$0.0042", last30Micros: "1200", last30Label: "$0.0012" })))
      .toBe("$0.0042 earned from invites · $0.0012 in the last 30 days");
    expect(earnedLine(view({ earnedMicros: "4200", earnedLabel: "$0.0042" }))).toBe("$0.0042 earned from invites");
  });
});

describe("how it works", () => {
  it("states the live terms in three lines", () => {
    expect(howItWorks(view().rates)).toEqual([
      "You get 10% of what ADCode earns from the ads the people you invite see, for a year.",
      "Bring an advertiser and you get 5% of what they spend.",
      "It comes out of ADCode's half. The people you invite keep every cent of theirs.",
    ]);
    expect(howItWorks({ userPercent: 12, advertiserPercent: 4, windowDays: 180 })[0]).toBe(
      "You get 12% of what ADCode earns from the ads the people you invite see, for 180 days.",
    );
  });
});

describe("being invited", () => {
  it("names the inviter when they allow it", () => {
    expect(invitedLine(view())).toBeNull();
    expect(invitedLine(view({ claimed: true, invitedBy: "Sam" }))).toBe("Invited by Sam");
    expect(invitedLine(view({ claimed: true, invitedBy: null }))).toBe("You joined with an invite");
  });

  it("says why a code was not accepted", () => {
    expect(claimMessage({ ok: true, inviterName: "Sam" })).toBe("Invited by Sam - you're connected.");
    expect(claimMessage({ ok: true, inviterName: null })).toBe("Invite linked - you're connected.");
    expect(claimMessage({ ok: false, error: "unknown-code" })).toBe("That code isn't one we know. Check it and try again.");
    expect(claimMessage({ ok: false, error: "own-code" })).toBe("That's your own code - send it to someone else.");
    expect(claimMessage({ ok: false, error: "too-late" })).toBe("Codes can only be added in an account's first 14 days.");
    expect(claimMessage({ ok: false, error: "already-claimed" })).toBe("This account already has an invite.");
    expect(claimMessage({ ok: false, error: "invalid" })).toBe("Paste the code or the whole invite link.");
    expect(claimMessage({ ok: false, error: "offline" })).toBe("Couldn't reach ADCode. Check your connection and try again.");
    expect(claimMessage({ ok: false, error: "unavailable" })).toBe("Invites aren't available right now. Try again later.");
  });
});

describe("the name switch", () => {
  it("previews the exact sentence the invite page will show", () => {
    expect(namePreview(view())).toBe("Your invite page says: “Sam invited you to ADCode”");
  });
});
