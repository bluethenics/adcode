import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { windowIconPath } from "../src/main/windowIcon.ts";

describe("windowIconPath", () => {
  it("keeps a packaged icon inside the application archive", () => {
    const appPath = "C:\\ADCode\\resources\\app.asar";
    expect(windowIconPath(appPath, true, win32)).toBe(
      "C:\\ADCode\\resources\\app.asar\\build\\icon.png",
    );
  });

  it("finds the repository icon when Electron runs the desktop workspace", () => {
    const appPath = "E:\\adcode\\apps\\desktop";
    expect(windowIconPath(appPath, false, win32)).toBe("E:\\adcode\\build\\icon.png");
  });
});
