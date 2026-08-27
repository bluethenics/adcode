import { join } from "node:path";

export interface PathJoiner {
  join(...paths: string[]): string;
}

/** Resolve the window icon inside the live application directory (including app.asar). */
export function windowIconPath(appPath: string, path: PathJoiner = { join }): string {
  return path.join(appPath, "build", "icon.png");
}
