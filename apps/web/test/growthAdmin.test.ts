import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROWTH_LOOPS, loopVisits, untaggedVisits } from "../src/lib/loops";
import { inviteLoopSource } from "../src/lib/websiteAnalytics";
import { nextSettlement } from "../src/components/growth/GrowthOverview";
import { broughtIn } from "../src/components/growth/PartnersTable";
import { rowForCode } from "../src/components/growth/CampaignLinks";
import type { SourceRowView } from "../src/lib/sources";

const repo = (relative: string): string => readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

describe("Admin > Growth > Loops", () => {
  /*
   * A loop is only as measurable as the tag on the link it hands out. Each tag here is pinned
   * to the line that sends it, so renaming one on either side breaks this rather than
   * quietly zeroing a row on the Loops screen.
   */
  const senders: Record<string, [file: string, needle: string][]> = {
    build: [["apps/desktop/src/renderer/main.ts", 'inviteLink(view.code, "build")']],
    x: [["apps/desktop/src/main/referralClient.ts", "inviteLink(view.code, target)"], ["apps/desktop/src/shared/invite.ts", '"x" | "threads" | "email"']],
    threads: [["apps/desktop/src/main/referralClient.ts", "inviteLink(view.code, target)"]],
    email: [["apps/desktop/src/main/referralClient.ts", "inviteLink(view.code, target)"]],
    readme: [["apps/desktop/src/renderer/invite/invitePanel.ts", 'inviteLink(view.code, "readme")']],
    collab: [["apps/desktop/src/renderer/collab/collabPanel.ts", 'inviteLink(view.code, "collab")']],
    "advertiser-pitch": [["apps/desktop/src/renderer/invite/invitePanel.ts", "?for=ads"]],
    dashboard: [["apps/web/src/components/InvitePanel.tsx", "?from=dashboard"]],
    portal: [["apps/web/src/components/ReferAdvertiser.tsx", "?for=ads&from=portal"]],
    "send-to-desktop": [["apps/web/src/components/HeroInstall.tsx", "?utm_source=send-to-desktop"]],
  };

  it("pins every loop tag to the code that sends it", () => {
    const tags = GROWTH_LOOPS.flatMap((loop) => loop.tags);
    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual(Object.keys(senders).sort());
    for (const [tag, places] of Object.entries(senders)) {
      for (const [file, needle] of places) expect(repo(file), `${tag} in ${file}`).toContain(needle);
    }
  });

  it("says where a loop without tags is measured, and every loop has words", () => {
    for (const loop of GROWTH_LOOPS) {
      expect(loop.name.length).toBeGreaterThan(3);
      expect(loop.ask.length).toBeGreaterThan(20);
      if (loop.tags.length === 0) expect(loop.measure, loop.id).toBeTruthy();
    }
  });

  it("adds a loop's tags and leaves the rest as untagged visits", () => {
    const pages = [{ label: "x", count: 4 }, { label: "threads", count: 2 }, { label: "readme", count: 3 }, { label: "direct", count: 5 }, { label: "google", count: 1 }];
    const share = GROWTH_LOOPS.find((loop) => loop.id === "share-buttons")!;
    const thanks = GROWTH_LOOPS.find((loop) => loop.id === "thank-you")!;
    expect(loopVisits(share, pages)).toBe(6);
    expect(loopVisits(thanks, pages)).toBeNull();
    expect(loopVisits(share, undefined)).toBeNull();
    expect(untaggedVisits(pages)).toBe(6);
  });
});

describe("invite links name their loop in website analytics", () => {
  const query = (search: string) => new URLSearchParams(search);

  it("reads ?from= and ?for=ads on invite pages only", () => {
    expect(inviteLoopSource("/i/abc1234", query("?from=readme"))).toBe("readme");
    expect(inviteLoopSource("/i/abc1234/", query("?from=collab"))).toBe("collab");
    expect(inviteLoopSource("/i/abc1234", query("?for=ads"))).toBe("advertiser-pitch");
    expect(inviteLoopSource("/i/abc1234", query("?for=ads&from=portal"))).toBe("portal");
    expect(inviteLoopSource("/i/abc1234", query(""))).toBe("");
    expect(inviteLoopSource("/versions", query("?from=readme"))).toBe("");
    expect(inviteLoopSource("/dashboard", query("?for=ads"))).toBe("");
  });

  it("refuses anything that is not a short plain tag", () => {
    expect(inviteLoopSource("/i/abc1234", query("?from=<script>"))).toBe("");
    expect(inviteLoopSource("/i/abc1234", query(`?from=${"a".repeat(81)}`))).toBe("");
  });
});

describe("Growth numbers", () => {
  it("counts down to the nightly 00:30 UTC settlement", () => {
    const day = Date.UTC(2026, 9, 7);
    expect(nextSettlement(day)).toEqual({ at: day + 30 * 60_000, label: "in 30 min" });
    expect(nextSettlement(day + 31 * 60_000)).toEqual({ at: day + 86_400_000 + 30 * 60_000, label: "in 23 h 59 min" });
  });

  it("adds a partner's ad revenue and advertiser spend exactly", () => {
    expect(broughtIn({ adRevenueMicros: "900000000000000001", advertiserSpendMicros: "2" })).toBe("900000000000000003");
  });

  it("finds a campaign link's row by its code and nothing else", () => {
    const row = (kind: SourceRowView["kind"], code: string | null): SourceRowView => ({
      key: `${kind}-${code}`, kind, code, label: "", visits: 1, people: 1, realUsers: 1, cameBack: 0,
      adRevenueMicros: "0", advertisers: 0, advertiserSpendMicros: "0", paidMicros: "0", keptMicros: "0",
    });
    const rows = [row("users", null), row("campaign", "threads-oct07"), row("unknown", null)];
    expect(rowForCode(rows, "threads-oct07")?.key).toBe("campaign-threads-oct07");
    expect(rowForCode(rows, "x-oct07")).toBeNull();
    expect(rowForCode(undefined, "threads-oct07")).toBeNull();
  });
});
