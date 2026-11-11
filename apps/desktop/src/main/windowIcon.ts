import { join } from "node:path";

export interface PathJoiner {
  join(...paths: string[]): string;
}

/**
 * Resolve the icon inside app.asar when packaged and the repository root in development.
 *
 * On Windows it is the .ico, not the PNG. Reported: the taskbar showed a small grey mark in a
 * black square. A window given the 512-pixel PNG has it shrunk to 24 or 32 pixels by Windows,
 * which blurs the mark to nothing; the .ico carries a drawing made for each small size
 * (`build/icon-small.svg`), and Windows picks the right one.
 */
export function windowIconPath(
  appPath: string,
  packaged: boolean,
  path: PathJoiner = { join },
  platform: string = process.platform,
): string {
  const iconRoot = packaged ? appPath : path.join(appPath, "..", "..");
  return path.join(iconRoot, "build", platform === "win32" ? "icon.ico" : "icon.png");
}
