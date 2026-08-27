import { describe, expect, it } from "vitest";
import { chooseReleaseDirectory } from "../src/releaseDirectory.ts";

describe("chooseReleaseDirectory", () => {
  it("uses an explicit override on every platform", () => {
    expect(
      chooseReleaseDirectory({
        repo: "E:\\repo",
        platform: "win32",
        env: { ADCODE_RELEASE_DIR: "C:\\artifacts" },
        volumeInfo: "File System Name : FAT32",
      }),
    ).toBe("C:\\artifacts");
  });

  it("keeps the repository release directory on NTFS", () => {
    expect(
      chooseReleaseDirectory({
        repo: "C:\\repo",
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        volumeInfo: "File System Name : NTFS",
      }),
    ).toBe("C:\\repo\\release");
  });

  it("moves FAT builds to the local application data directory", () => {
    expect(
      chooseReleaseDirectory({
        repo: "E:\\repo",
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        volumeInfo: "File System Name : FAT32",
      }),
    ).toBe("C:\\Users\\me\\AppData\\Local\\adcode\\release");
  });

  it("uses the repository release directory outside Windows", () => {
    expect(
      chooseReleaseDirectory({
        repo: "/work/adcode",
        platform: "linux",
        env: {},
        volumeInfo: "",
      }),
    ).toBe("/work/adcode/release");
  });
});
