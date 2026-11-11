import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { windowIconPath } from "../src/main/windowIcon.ts";

describe("windowIconPath", () => {
  it("keeps a packaged icon inside the application archive", () => {
    const appPath = "C:\\ADCode\\resources\\app.asar";
    expect(windowIconPath(appPath, true, win32, "linux")).toBe(
      "C:\\ADCode\\resources\\app.asar\\build\\icon.png",
    );
  });

  it("finds the repository icon when Electron runs the desktop workspace", () => {
    const appPath = "E:\\adcode\\apps\\desktop";
    expect(windowIconPath(appPath, false, win32, "darwin")).toBe("E:\\adcode\\build\\icon.png");
  });

  // Reported: the taskbar icon was a small grey mark in a black square - the 512px PNG, shrunk.
  it("gives Windows the multi-size icon, so the taskbar gets a drawing made for its size", () => {
    expect(windowIconPath("C:\\ADCode\\resources\\app.asar", true, win32, "win32")).toBe("C:\\ADCode\\resources\\app.asar\\build\\icon.ico");
    expect(windowIconPath("E:\\adcode\\apps\\desktop", false, win32, "win32")).toBe("E:\\adcode\\build\\icon.ico");
  });
});
