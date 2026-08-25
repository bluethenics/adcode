import { describe, it, expect } from "vitest";
import { getSetting } from "@adcode/settings";
import { resolveTheme } from "../src/renderer/theme.ts";

describe("resolveTheme", () => {
  it("follows the system when nobody has chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("honours an explicit light or dark whatever the machine says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("never flips Midnight to follow the system", () => {
    // The rule this module exists for. Midnight is a look, not a brightness, and an
    // editor that switched someone into Light at sunrise would be overruling them.
    expect(resolveTheme("midnight", true)).toBe("midnight");
    expect(resolveTheme("midnight", false)).toBe("midnight");
  });

  it("falls back to the system for a value it does not recognise", () => {
    // An absent setting, or one written by a newer build than this one.
    for (const junk of [undefined, null, "", "solarized", 7, {}]) {
      expect(resolveTheme(junk, true)).toBe("dark");
      expect(resolveTheme(junk, false)).toBe("light");
    }
  });
});

describe("the appearance setting", () => {
  const setting = getSetting("adcode.appearance.theme");

  it("offers every theme the renderer can resolve, and system", () => {
    expect(setting).toBeDefined();
    expect(setting?.kind).toBe("enum");

    const values = setting?.kind === "enum" ? setting.options.map((o) => o.value) : [];
    expect(values).toEqual(["system", "light", "dark", "midnight"]);
  });

  it("resolves every offered value to something real", () => {
    // The catalogue and the resolver are edited in different files, and an option nobody
    // can select is only visible by trying it. `system` is the one that legitimately
    // depends on the machine; the rest must come back as themselves.
    const values = setting?.kind === "enum" ? setting.options.map((o) => o.value) : [];

    for (const value of values.filter((v) => v !== "system")) {
      expect(resolveTheme(value, true)).toBe(value);
      expect(resolveTheme(value, false)).toBe(value);
    }
  });
});
