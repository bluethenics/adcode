import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { windowIconPath } from "../src/main/windowIcon.ts";

describe("windowIconPath", () => {
  it("keeps a packaged icon inside the application archive", () => {
    const appPath = "C:\\ADCode\\resources\\app.asar";
    expect(windowIconPath(appPath, win32)).toBe("C:\\ADCode\\resources\\app.asar\\build\\icon.png");
  });
});
