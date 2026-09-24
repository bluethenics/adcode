import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, pasteText } from "../src/renderer/clipboard.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared renderer clipboard", () => {
  it("reports failure instead of throwing when no clipboard exists", async () => {
    await expect(copyText("hello")).resolves.toBe(false);
    await expect(pasteText()).resolves.toBe("");
  });

  it("copies and pastes through the Electron bridge first", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const readText = vi.fn(async () => "from-bridge");
    vi.stubGlobal("window", { adcode: { clipboard: { writeText, readText } } });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    await expect(pasteText()).resolves.toBe("from-bridge");
  });

  it("falls back to the web clipboard when the bridge rejects", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("window", {
      adcode: {
        clipboard: {
          writeText: async (_text: string) => {
            throw new Error("denied");
          },
          readText: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
        readText: async () => "from-web",
      },
    });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    await expect(pasteText()).resolves.toBe("from-web");
  });
});
