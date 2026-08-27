import { describe, expect, it } from "vitest";
import {
  decideAnnouncement,
  parseReleaseList,
  releasesInBuild,
  versionsToMarkSeen,
  type AnnounceState,
  type Release,
} from "../src/index.ts";

const release = (overrides: Partial<Release> = {}): Release => ({
  version: "1.2.0",
  title: "Safer editing",
  body: "ADCode now protects overlapping changes.",
  highlights: ["Protected edits"],
  announce: true,
  critical: false,
  publishedAt: 1_777_777_777_000,
  ...overrides,
});

const state = (overrides: Partial<AnnounceState> = {}): AnnounceState => ({
  releases: [release()],
  currentVersion: "1.2.0",
  seenVersions: new Set<string>(),
  hasRunBefore: true,
  enabled: true,
  moment: {
    windowFocused: true,
    typing: false,
    commandRunning: false,
    debugActive: false,
  },
  ...overrides,
});

describe("parseReleaseList", () => {
  it("drops malformed records while normalizing optional fields", () => {
    const parsed = parseReleaseList([
      {
        version: "1.2.0",
        title: "Safer editing",
        body: 42,
        highlights: ["Protected edits", 7, null],
        announce: "yes",
        critical: true,
        publishedAt: 1_777_777_777_000,
      },
      { version: "../../escape", title: "Unsafe", publishedAt: 1 },
      { version: "1.1.0", title: "", publishedAt: 1 },
      null,
    ]);

    expect(parsed).toEqual([
      {
        version: "1.2.0",
        title: "Safer editing",
        body: "",
        highlights: ["Protected edits"],
        announce: false,
        critical: true,
        publishedAt: 1_777_777_777_000,
      },
    ]);
  });
});

describe("releasesInBuild", () => {
  it("excludes future versions and sorts numeric semantic versions newest first", () => {
    const notes = [
      release({ version: "1.2.0", publishedAt: 20 }),
      release({ version: "2.0.0", publishedAt: 50 }),
      release({ version: "1.10.0", publishedAt: 40 }),
      release({ version: "1.1.10", publishedAt: 10 }),
      release({ version: "1.3.0", publishedAt: 30 }),
    ];

    expect(releasesInBuild(notes, "1.10.0").map((note) => note.version)).toEqual([
      "1.10.0",
      "1.3.0",
      "1.2.0",
      "1.1.10",
    ]);
  });
});

describe("decideAnnouncement", () => {
  it("does not announce when release cards are disabled", () => {
    expect(decideAnnouncement(state({ enabled: false }))).toEqual({
      show: false,
      reason: "disabled",
    });
  });

  it("does not announce existing notes on a first run", () => {
    expect(decideAnnouncement(state({ hasRunBefore: false }))).toEqual({
      show: false,
      reason: "first-run",
    });
  });

  it("shows the newest eligible unseen release", () => {
    const eligible = release({ version: "1.0.0" });
    expect(
      decideAnnouncement(
        state({
          releases: [
            release({ version: "2.0.0" }),
            release({ version: "1.2.0" }),
            release({ version: "1.1.0", announce: false }),
            release({ version: "0.9.0" }),
            eligible,
          ],
          seenVersions: new Set(["1.2.0"]),
        }),
      ),
    ).toEqual({ show: true, release: eligible });
  });

  it.each([
    { windowFocused: false, typing: false, commandRunning: false, debugActive: false },
    { windowFocused: true, typing: true, commandRunning: false, debugActive: false },
    { windowFocused: true, typing: false, commandRunning: true, debugActive: false },
    { windowFocused: true, typing: false, commandRunning: false, debugActive: true },
  ])("waits while the user is busy: $moment", (moment) => {
    expect(decideAnnouncement(state({ moment }))).toEqual({ show: false, reason: "busy" });
  });

  it("lets a critical unseen release bypass the busy-moment check", () => {
    const critical = release({ critical: true });
    expect(
      decideAnnouncement(
        state({
          releases: [critical],
          moment: { windowFocused: false, typing: true, commandRunning: true, debugActive: true },
        }),
      ),
    ).toEqual({ show: true, release: critical });
  });
});

describe("versionsToMarkSeen", () => {
  it("marks the shown release and older unseen build notes without replaying newer ones", () => {
    const shown = release({ version: "1.2.0" });
    const result = versionsToMarkSeen(
      state({
        currentVersion: "1.4.0",
        releases: [
          release({ version: "1.4.0" }),
          release({ version: "1.3.0" }),
          shown,
          release({ version: "1.1.0", announce: false }),
          release({ version: "1.0.0" }),
        ],
        seenVersions: new Set(["1.1.0"]),
      }),
      shown,
    );

    expect(result).toEqual(["1.2.0", "1.0.0"]);
  });
});
