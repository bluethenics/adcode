import { join } from "node:path";

export interface PathJoiner {
  join(...paths: string[]): string;
}

/** Resolve the icon inside app.asar when packaged and the repository root in development. */
export function windowIconPath(
  appPath: string,
  packaged: boolean,
  path: PathJoiner = { join },
): string {
  const iconRoot = packaged ? appPath : path.join(appPath, "..", "..");
  return path.join(iconRoot, "build", "icon.png");
}
