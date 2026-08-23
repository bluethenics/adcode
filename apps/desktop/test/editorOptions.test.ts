/**
 * The settings-to-Monaco mapping, which is where a settings row quietly becomes a lie.
 *
 * These assertions exist because of a real bug: the "Multi-cursor and column select" row
 * was wired to Monaco's `columnSelection`, and that row defaults to on - so every install
 * shipped with column selection enabled, and dragging the mouse across a line selected a
 * rectangular block instead of the line. Monaco's own note on the option is "Enable that
 * the selection with the mouse and keys is doing column selection. Defaults to false",
 * and it defaults to false precisely because it is a mode rather than a preference.
 *
 * Tested here rather than through the editor because the mapping is pure: the whole point
 * of `editorOptions.ts` importing no Monaco is that this file needs no window to run.
 */
import { describe, expect, it } from "vitest";
import { defaultSettings, SETTINGS_SCHEMA } from "@adcode/settings";
import { editorOptionsFor } from "../src/renderer/editor/editorOptions.ts";

describe("editorOptionsFor", () => {
  const defaults = defaultSettings();

  it("leaves column selection off under the shipped defaults", () => {
    // The regression itself. If this fails, dragging across a line box-selects again.
    expect(editorOptionsFor(defaults).columnSelection).toBe(false);
  });

  it("does not let the multi-cursor row turn column selection on", () => {
    const options = editorOptionsFor({ ...defaults, "adcode.editing.multiCursor": true });
    expect(options.columnSelection).toBe(false);
  });

  it("turns column selection on only for its own row", () => {
    const options = editorOptionsFor({ ...defaults, "adcode.editing.columnSelection": true });
    expect(options.columnSelection).toBe(true);
  });

  it("disables multi-cursor with a cursor limit of one", () => {
    // Monaco has no on/off for multi-cursor, but `multiCursorLimit` is a real cap, and a
    // cap of one is exactly "no second cursor" - which is what the row has always claimed.
    const options = editorOptionsFor({ ...defaults, "adcode.editing.multiCursor": false });
    expect(options.multiCursorLimit).toBe(1);
  });

  it("allows many cursors when the row is on", () => {
    expect(editorOptionsFor(defaults).multiCursorLimit).toBeGreaterThan(1);
  });

  it("still maps the rows it always mapped", () => {
    const options = editorOptionsFor({
      ...defaults,
      "adcode.editing.minimap": false,
      "adcode.editing.codeFolding": false,
      "adcode.editing.indentGuides": false,
      "adcode.editing.trailingWhitespace": true,
    });

    expect(options.minimap.enabled).toBe(false);
    expect(options.folding).toBe(false);
    expect(options.guides.indentation).toBe(false);
    expect(options.renderWhitespace).toBe("trailing");
  });

  it("treats a missing value as the setting being on", () => {
    // `applySettings` is called with whatever the store returns, which on a fresh profile
    // is missing every key. Reading that as "off" would ship an editor with no minimap,
    // no folding, and no guides on first launch.
    const options = editorOptionsFor({});
    expect(options.minimap.enabled).toBe(true);
    expect(options.folding).toBe(true);
    expect(options.columnSelection).toBe(false);
  });

  it("maps every editing row the schema declares available", () => {
    // Guards the other direction: a row added to the roster with `available: true` that
    // nothing reads is a switch that does nothing when a user flips it.
    const mapped = new Set([
      "adcode.editing.bracketPairColorization",
      "adcode.editing.stickyScroll",
      "adcode.editing.indentGuides",
      "adcode.editing.trailingWhitespace",
      "adcode.editing.minimap",
      "adcode.editing.codeFolding",
      "adcode.editing.multiCursor",
      "adcode.editing.columnSelection",
      "adcode.editing.suggestions",
      "adcode.editing.acceptOnEnter",
      "adcode.editing.wordSuggestions",
    ]);

    const unmapped = SETTINGS_SCHEMA.filter(
      (setting) =>
        setting.group === "editing" && setting.available && !mapped.has(setting.id),
    ).map((setting) => setting.id);

    // Three settings are honoured somewhere other than Monaco's options, and each one is
    // listed here so that "available but unmapped" stays a deliberate set rather than a
    // place a forgotten setting can hide: `inlineGitBlame` by the git overlay,
    // `autoCloseTags` by the editor host's own tag-closing listener, and
    // `plainEnglishErrors` by the Problems panel and the hover provider.
    expect(unmapped).toEqual([
      "adcode.editing.inlineGitBlame",
      "adcode.editing.autoCloseTags",
      "adcode.editing.fileTemplates",
      "adcode.editing.plainEnglishErrors",
    ]);
  });
});

describe("suggestions", () => {
  it("suggests as you type, and takes it on Enter, out of the box", () => {
    const options = editorOptionsFor({});

    expect(options.quickSuggestions).toBe(true);
    expect(options.acceptSuggestionOnEnter).toBe("on");
    expect(options.tabCompletion).toBe("on");
  });

  it("degrades Enter to 'smart' rather than off", () => {
    // Someone switching this row off wants Enter to be a newline, not to lose completions.
    // `"off"` would strand the widget with no keyboard way to accept from the home row.
    const options = editorOptionsFor({ "adcode.editing.acceptOnEnter": false });

    expect(options.acceptSuggestionOnEnter).toBe("smart");
    expect(options.quickSuggestions).toBe(true);
  });

  it("turns the whole widget off when the master row is off", () => {
    const options = editorOptionsFor({ "adcode.editing.suggestions": false });

    expect(options.quickSuggestions).toBe(false);
    expect(options.suggestOnTriggerCharacters).toBe(false);
    expect(options.tabCompletion).toBe("off");
  });

  it("never scans every open document for words", () => {
    // `allDocuments` is a per-keystroke cost across every open model, on the one code path
    // §7 says nothing the user types may ever wait on.
    expect(editorOptionsFor({}).wordBasedSuggestions).toBe("currentDocument");
    expect(
      editorOptionsFor({ "adcode.editing.wordSuggestions": false }).wordBasedSuggestions,
    ).toBe("off");
  });

  it("pre-selects the first entry, so Enter has something to take", () => {
    expect(editorOptionsFor({}).suggestSelection).toBe("first");
  });

  it("leaves word suggestions on when only the master row is read as missing", () => {
    // A fresh profile has no keys at all. Reading that as "off" would ship an editor with
    // no completions to every new install.
    const options = editorOptionsFor({});

    expect(options.wordBasedSuggestions).toBe("currentDocument");
    expect(options.suggestOnTriggerCharacters).toBe(true);
  });
});
