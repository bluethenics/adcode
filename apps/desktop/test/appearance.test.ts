import { describe, expect, it } from "vitest";
import { getSetting } from "@adcode/settings";
import {
  editorFont,
  reduceMotion,
  stepTextSize,
  stepZoom,
  terminalFontSize,
  TEXT_SIZES,
  textScale,
  ZOOM_STEPS,
  zoomFactor,
  zoomLabel,
} from "../src/renderer/appearanceModel.ts";
import { assistantName, chatAppearanceFrom, DEFAULT_ASSISTANT_LOOK } from "../src/renderer/ai/chatAppearance.ts";
import { MASCOT_COLORS, MASCOT_SHAPES } from "../src/renderer/agents/mascotStyle.ts";
import { editorOptionsFor } from "../src/renderer/editor/editorOptions.ts";

const options = (id: string): string[] => {
  const setting = getSetting(id);
  return setting?.kind === "enum" ? setting.options.map((option) => option.value) : [];
};

describe("zoom", () => {
  it("steps through exactly the sizes the Settings row offers", () => {
    expect([...ZOOM_STEPS]).toEqual(options("adcode.appearance.zoom"));
  });

  it("goes one size at a time, stops at the ends, and resets to 100%", () => {
    expect(stepZoom("100", 1)).toBe("110");
    expect(stepZoom("100", -1)).toBe("90");
    expect(stepZoom("200", 1)).toBe("200");
    expect(stepZoom("80", -1)).toBe("80");
    expect(stepZoom("150", 0)).toBe("100");
    expect(stepZoom("nonsense", 1)).toBe("110");
  });

  it("turns the setting into the window's factor, and a bad value into 100%", () => {
    expect(zoomFactor("125")).toBe(1.25);
    expect(zoomFactor("7")).toBe(1);
    expect(zoomLabel("175")).toBe("175%");
  });
});

describe("text size", () => {
  it("steps through exactly the sizes the Settings row offers", () => {
    expect([...TEXT_SIZES]).toEqual(options("adcode.appearance.textSize"));
    expect(stepTextSize("default", 1)).toBe("large");
    expect(stepTextSize("largest", 1)).toBe("largest");
    expect(stepTextSize("large", 0)).toBe("default");
  });

  it("leaves the editor and terminal exactly as they were at the default size", () => {
    expect(editorFont("default")).toEqual({ fontSize: 13, lineHeight: 20 });
    expect(terminalFontSize("default")).toBe(12);
    expect(textScale(undefined)).toBe(1);
  });

  it("grows the code, the terminal and the chat together", () => {
    expect(editorFont("largest").fontSize).toBeGreaterThan(13);
    expect(terminalFontSize("largest")).toBeGreaterThan(12);
    expect(editorFont("small").fontSize).toBeLessThan(13);
    const options = editorOptionsFor({ "adcode.appearance.textSize": "larger" });
    expect(options.fontSize).toBe(16);
    expect(options.suggestFontSize).toBe(options.fontSize);
    expect(options.suggestLineHeight).toBe(options.lineHeight);
  });
});

describe("motion", () => {
  it("follows the system unless told otherwise", () => {
    expect(reduceMotion("system", true)).toBe(true);
    expect(reduceMotion("system", false)).toBe(false);
    expect(reduceMotion("reduce", false)).toBe(true);
    expect(reduceMotion("full", true)).toBe(false);
    expect(reduceMotion(undefined, true)).toBe(true);
  });
});

describe("how agents look in the chat", () => {
  it("offers exactly the shapes and colours a mascot can be drawn in", () => {
    expect(options("adcode.appearance.assistantShape")).toEqual([...MASCOT_SHAPES]);
    expect(options("adcode.appearance.assistantColor")).toEqual([...MASCOT_COLORS]);
  });

  it("reads the settings, and falls back to the defaults for anything it cannot draw", () => {
    expect(chatAppearanceFrom({})).toEqual({ name: "Assistant", look: DEFAULT_ASSISTANT_LOOK, avatars: true, style: "document" });
    expect(chatAppearanceFrom({
      "adcode.appearance.assistantName": "  Ada  ",
      "adcode.appearance.assistantShape": "hexagon",
      "adcode.appearance.assistantColor": "teal",
      "adcode.appearance.agentAvatars": false,
      "adcode.appearance.messageStyle": "bubbles",
    })).toEqual({ name: "Ada", look: { shape: "hexagon", color: "teal" }, avatars: false, style: "bubbles" });
    expect(chatAppearanceFrom({ "adcode.appearance.assistantShape": "triangle", "adcode.appearance.messageStyle": "wild" }))
      .toMatchObject({ look: DEFAULT_ASSISTANT_LOOK, style: "document" });
  });

  it("keeps a name to one printable line, and never empty", () => {
    expect(assistantName("")).toBe("Assistant");
    expect(assistantName("   ")).toBe("Assistant");
    expect(assistantName("Line\none")).toBe("Line one");
    expect(assistantName("x".repeat(90))).toHaveLength(40);
  });
});
