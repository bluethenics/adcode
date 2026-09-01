import { describe, expect, it } from "vitest";
import {
  initialPopupLayer,
  reducePopupLayer,
} from "../src/renderer/workbench/popupLayer.ts";

describe("pop-up layer", () => {
  it("replaces one primary pop-up with another", () => {
    const sourceControl = reducePopupLayer(initialPopupLayer(), {
      type: "open-primary",
      id: "source-control",
    });
    const chat = reducePopupLayer(sourceControl, { type: "open-primary", id: "chat" });
    expect(chat).toEqual({ primary: "chat", dependent: null });
  });

  it("keeps one dependent above its owning primary", () => {
    const chat = reducePopupLayer(initialPopupLayer(), { type: "open-primary", id: "chat" });
    const connect = reducePopupLayer(chat, {
      type: "open-dependent",
      id: "connect",
      owner: "chat",
    });
    expect(connect).toEqual({ primary: "chat", dependent: "connect" });
  });

  it("opens help as a settings-owned dependent", () => {
    const settings = reducePopupLayer(initialPopupLayer(), {
      type: "open-primary",
      id: "settings",
    });
    expect(
      reducePopupLayer(settings, {
        type: "open-dependent",
        id: "help",
        owner: "settings",
      }),
    ).toEqual({ primary: "settings", dependent: "help" });
  });

  it("closes the dependent before the primary", () => {
    const layered = { primary: "chat" as const, dependent: "connect" as const };
    const once = reducePopupLayer(layered, { type: "escape" });
    expect(once).toEqual({ primary: "chat", dependent: null });
    expect(reducePopupLayer(once, { type: "escape" })).toEqual({
      primary: null,
      dependent: null,
    });
  });

  it("toggles an anchored primary from its launcher", () => {
    const open = reducePopupLayer(initialPopupLayer(), {
      type: "toggle-primary",
      id: "earnings",
    });
    expect(open.primary).toBe("earnings");
    expect(reducePopupLayer(open, { type: "toggle-primary", id: "earnings" }).primary)
      .toBeNull();
  });
});
