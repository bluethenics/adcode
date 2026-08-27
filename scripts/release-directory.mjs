import { execFileSync } from "node:child_process";
import process from "node:process";
import { chooseReleaseDirectory } from "../packages/release/src/releaseDirectory.ts";

/** Detect the live filesystem and apply the pure release-directory policy. */
export function releaseDirectory(repo = process.cwd()) {
  const override = process.env["ADCODE_RELEASE_DIR"];
  if (typeof override === "string" && override.length > 0) {
    return chooseReleaseDirectory({ repo, platform: process.platform, env: process.env, volumeInfo: "" });
  }

  let volumeInfo = "";
  if (process.platform === "win32") {
    try {
      volumeInfo = execFileSync("fsutil", ["fsinfo", "volumeinfo", repo.slice(0, 2)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // If detection is unavailable, the safe default is the repository release folder.
    }
  }

  return chooseReleaseDirectory({
    repo,
    platform: process.platform,
    env: process.env,
    volumeInfo,
  });
}
