/**
 * Editing project memory from the Tools page. A memory name becomes a file on the user's disk
 * under `.adcode/memory`, so everything the renderer sends is validated in main against the
 * same rules the memory store uses - the renderer is treated as hostile.
 */
import { describe, expect, it } from "vitest";
import { parseMemoryName, parseMemoryWrite } from "../src/main/memoryIpcValidation.ts";
import { CHANNELS } from "../src/shared/api.ts";

const good = { name: "use-pnpm", description: "The project uses pnpm, never npm", type: "convention", body: "Always run pnpm install." };

describe("memory writes from the renderer", () => {
  it("accepts a well-formed memory and normalises its name", () => {
    expect(parseMemoryWrite({ ...good, name: "  Use-PNPM " })).toEqual({ ...good, name: "use-pnpm" });
  });

  it("refuses names that could escape the memory folder or are not files on every platform", () => {
    for (const name of ["../secrets", "a/b", "con", "has space", "", "x".repeat(129), "dot.name"]) {
      expect(parseMemoryWrite({ ...good, name }), name).toBeNull();
    }
  });

  it("refuses the session kind, which only the assistant writes", () => {
    expect(parseMemoryWrite({ ...good, type: "session" })).toBeNull();
    expect(parseMemoryWrite({ ...good, type: "anything" })).toBeNull();
  });

  it("bounds the text and refuses empty or binary fields", () => {
    expect(parseMemoryWrite({ ...good, description: "" })).toBeNull();
    expect(parseMemoryWrite({ ...good, description: "x".repeat(301) })).toBeNull();
    expect(parseMemoryWrite({ ...good, body: "" })).toBeNull();
    expect(parseMemoryWrite({ ...good, body: "x".repeat(20_001) })).toBeNull();
    expect(parseMemoryWrite({ ...good, body: "a\u0000b" })).toBeNull();
    expect(parseMemoryWrite("nope")).toBeNull();
    expect(parseMemoryWrite({ ...good, description: "  trims  " })?.description).toBe("trims");
  });

  it("checks a name before a delete", () => {
    expect(parseMemoryName("Use-PNPM")).toBe("use-pnpm");
    expect(parseMemoryName("../x")).toBeNull();
    expect(parseMemoryName(42)).toBeNull();
  });

  it("has its own channels", () => {
    const names = [CHANNELS.memoryList, CHANNELS.memoryWrite, CHANNELS.memoryRemove];
    expect(new Set([...names, CHANNELS.memoryConnection]).size).toBe(4);
    expect(names.every((name) => typeof name === "string" && name.startsWith("memory:"))).toBe(true);
  });
});
