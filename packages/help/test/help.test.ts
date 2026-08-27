/**
 * The coverage guarantee.
 *
 * The point of this file is the first test in it: a setting that ships without an
 * explanation fails `npm run verify`. Everything else here protects that one from being
 * satisfied by an empty string or a broken link.
 *
 * This is deliberately a build-breaking test rather than a lint or a note in a
 * contributing guide. Documentation that is optional is documentation that is missing,
 * and the whole reason this package exists is that the product had fifty-five switches
 * and no answer to what any of them did.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_SCHEMA, getSetting } from "@adcode/settings";
import {
  HELP_ENTRIES,
  helpFor,
  helpForGroup,
  helpForSetting,
  helpGroups,
  relatedTo,
  searchHelp,
} from "@adcode/help";

describe("coverage", () => {
  it("explains every setting in the schema", () => {
    const unexplained = SETTINGS_SCHEMA.filter(
      (setting) => helpForSetting(setting.id) === undefined,
    ).map((setting) => setting.id);

    expect(unexplained).toEqual([]);
  });

  it("names only settings that exist", () => {
    const phantom = HELP_ENTRIES.flatMap((entry) =>
      entry.settingIds.filter((id) => getSetting(id) === undefined),
    );

    expect(phantom).toEqual([]);
  });

  it("does not let two entries claim the same setting", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const entry of HELP_ENTRIES) {
      for (const settingId of entry.settingIds) {
        const owner = seen.get(settingId);
        if (owner === undefined) seen.set(settingId, entry.id);
        else clashes.push(`${settingId}: ${owner} and ${entry.id}`);
      }
    }

    expect(clashes).toEqual([]);
  });
});

describe("entries", () => {
  it("has a unique id for each", () => {
    const ids = HELP_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fills in all three explanations", () => {
    const empty = HELP_ENTRIES.filter(
      (entry) =>
        entry.title.trim().length === 0 ||
        entry.plain.trim().length === 0 ||
        entry.why.trim().length === 0 ||
        entry.how.trim().length === 0,
    ).map((entry) => entry.id);

    expect(empty).toEqual([]);
  });

  /*
   * The plain sentence has a length ceiling because it is the field with a job that a
   * long sentence cannot do: it is the one a child reads, and it is the summary a search
   * engine shows. Two hundred and forty characters is roughly two sentences, which is the
   * point past which "plain" has quietly become "detailed".
   */
  it("keeps the plain explanation short", () => {
    const overlong = HELP_ENTRIES.filter((entry) => entry.plain.length > 240).map(
      (entry) => `${entry.id} (${String(entry.plain.length)})`,
    );

    expect(overlong).toEqual([]);
  });

  /*
   * A guard against the failure this package exists to prevent: an "explanation" that
   * repeats the label. "Sticky scroll: enables sticky scroll" passes every other test here
   * and teaches nobody anything.
   *
   * Measured as what is left after removing the title, rather than as whether the title
   * appears at all. Using the feature's own words is normal and often clearest - "Signing
   * in keeps your earnings attached to you" is a good sentence. What is not acceptable is
   * a sentence that is *only* the title plus filler, and the remainder is what tells the
   * two apart.
   */
  it("does not explain a feature with only its own title", () => {
    const circular = HELP_ENTRIES.filter((entry) => {
      const withoutTitle = entry.plain.toLowerCase().split(entry.title.toLowerCase()).join("");
      // Twenty-five letters is about five words. A tautology leaves almost nothing behind
      // ("enables"), while a short but real sentence - "Every time you save, the file gets
      // tidied first" - leaves plenty. The threshold sits between those two, not above the
      // shortest good sentence in the catalogue.
      return withoutTitle.replace(/[^a-z]/g, "").length < 25;
    }).map((entry) => entry.id);

    expect(circular).toEqual([]);
  });

  it("points related links at entries that exist", () => {
    const broken = HELP_ENTRIES.flatMap((entry) =>
      entry.related.filter((id) => helpFor(id) === undefined).map((id) => `${entry.id} -> ${id}`),
    );

    expect(broken).toEqual([]);
  });

  it("does not relate an entry to itself", () => {
    const selfish = HELP_ENTRIES.filter((entry) => entry.related.includes(entry.id)).map(
      (entry) => entry.id,
    );

    expect(selfish).toEqual([]);
  });
});

describe("lookup", () => {
  it("finds an entry by its id", () => {
    expect(helpFor("adcode.editing.stickyScroll")?.title).toBe("Sticky scroll");
  });

  it("returns undefined for an id nobody wrote", () => {
    expect(helpFor("adcode.editing.notAThing")).toBeUndefined();
  });

  it("finds the entry that explains a setting", () => {
    // Two settings, one behaviour: the entry for suggestions also owns accept-on-Enter.
    expect(helpForSetting("adcode.editing.suggestions")?.id).toBe("adcode.editing.suggestions");
  });

  it("groups entries, and lists only groups that have some", () => {
    const groups = helpGroups();
    expect(groups).toContain("editing");
    expect(groups).toContain("workbench");

    for (const group of groups) {
      expect(helpForGroup(group).length).toBeGreaterThan(0);
    }
  });

  it("resolves related entries to the real thing", () => {
    const entry = helpFor("adcode.editing.autoCloseTags");
    expect(entry).toBeDefined();
    expect(relatedTo(entry!).map((related) => related.id)).toContain(
      "adcode.editing.autoRenamePairedTag",
    );
  });
});

describe("search", () => {
  it("returns everything for an empty query", () => {
    expect(searchHelp("   ")).toHaveLength(HELP_ENTRIES.length);
  });

  /*
   * The case this package was written for: somebody describing a feature in their own
   * words, using none of the words it is named with.
   */
  it("finds a feature from a description rather than its name", () => {
    const found = searchHelp("grey text").map((entry) => entry.id);
    expect(found).toContain("adcode.ai.inlineCompletion");
  });

  it("searches the how, not only the title", () => {
    const found = searchHelp("Ctrl+Shift+P").map((entry) => entry.id);
    expect(found).toContain("workbench.commandPalette");
  });

  it("ignores case and surrounding space", () => {
    expect(searchHelp("  MINIMAP  ").map((entry) => entry.id)).toContain("adcode.editing.minimap");
  });

  it("returns nothing for a word nobody used", () => {
    expect(searchHelp("zzzznotaword")).toEqual([]);
  });
});
