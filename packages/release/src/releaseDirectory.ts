import { posix, win32 } from "node:path";

export interface ReleaseDirectoryInput {
  readonly repo: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly volumeInfo: string;
}

/** Choose one canonical artifact directory for packaging, validation, and smoke tests. */
export function chooseReleaseDirectory(input: ReleaseDirectoryInput): string {
  const path = input.platform === "win32" ? win32 : posix;
  const override = input.env["ADCODE_RELEASE_DIR"];
  if (typeof override === "string" && override.length > 0) {
    return path.resolve(input.repo, override);
  }

  if (input.platform === "win32" && /File System Name\s*:\s*(?:FAT|exFAT)/i.test(input.volumeInfo)) {
    return path.join(input.env["LOCALAPPDATA"] ?? input.repo, "adcode", "release");
  }

  return path.join(input.repo, "release");
}
