/**
 * `npm start` - build if anything changed, then launch ADCode.
 *
 * The build takes about ninety seconds, which is fine once and intolerable every time.
 * So this compares the newest source file against the newest build output and only
 * rebuilds when it has to: the first run builds, and every run after it opens straight
 * away. `npm start -- --force` rebuilds regardless.
 */
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));

/** Directories whose contents feed the build. */
const SOURCE_ROOTS = [
  join(REPO, "apps", "desktop", "src"),
  join(REPO, "packages"),
];

/** Single files that also invalidate a build when they change. */
const SOURCE_FILES = [
  join(REPO, "apps", "desktop", "electron.vite.config.ts"),
  join(REPO, "apps", "desktop", "package.json"),
  join(REPO, "package.json"),
];

// electron-vite writes beside the app, not at the repo root - `main` in the desktop
// package.json points at `./out/main/index.js` relative to itself.
const OUT = join(REPO, "apps", "desktop", "out");

const BUILD_OUTPUTS = [
  join(OUT, "main", "index.js"),
  join(OUT, "preload", "index.cjs"),
  join(OUT, "renderer", "index.html"),
];

/** The newest modification time under a directory, or 0 if it is not there. */
async function newestUnder(path) {
  let newest = 0;

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // `test` and `node_modules` do not affect the built app.
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "test") continue;
        await walk(join(current, entry.name));
        continue;
      }

      try {
        const info = await stat(join(current, entry.name));
        if (info.mtimeMs > newest) newest = info.mtimeMs;
      } catch {
        // A file that vanished mid-walk cannot be newer than the build in any way
        // that matters.
      }
    }
  }

  await walk(path);
  return newest;
}

async function mtimeOf(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function needsBuild() {
  if (process.argv.includes("--force")) return true;

  const built = await Promise.all(BUILD_OUTPUTS.map(mtimeOf));
  // A missing output means there is no usable build at all.
  if (built.some((time) => time === 0)) return true;

  const oldestOutput = Math.min(...built);

  const sourceTimes = await Promise.all([
    ...SOURCE_ROOTS.map(newestUnder),
    ...SOURCE_FILES.map(mtimeOf),
  ]);

  return Math.max(...sourceTimes) > oldestOutput;
}

/** Run a command and resolve with its exit code. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

if (await needsBuild()) {
  process.stdout.write("Building ADCode (first run, or sources changed)…\n");

  // Through the electron-vite entry script directly rather than `npm run`, so there is
  // one less shell between here and the build - `.cmd` shims and `spawn` disagree on
  // Windows. The bin is not in the package's `exports` map, so it is resolved by walking
  // up from `package.json` rather than by specifier.
  const electronVite = join(
    dirname(require.resolve("electron-vite/package.json")),
    "bin",
    "electron-vite.js",
  );
  const code = await run(process.execPath, [electronVite, "build"], {
    cwd: join(REPO, "apps", "desktop"),
  });

  if (code !== 0) {
    process.stderr.write("\nBuild failed - not launching.\n");
    process.exit(code);
  }
}

// The `electron` package's main export is the path to the real executable. The `.bin`
// shim is a `.cmd` on Windows and `spawn` refuses to run it.
const electronPath = require("electron");
process.stdout.write("Starting ADCode…\n");

const requested = process.argv.slice(2).filter((argument) => argument !== "--force");
const launchArguments = requested.length === 0 ? [] : ["--adcode-open", requested[0]];
process.exit(await run(electronPath, [join(REPO, "apps", "desktop"), ...launchArguments]));
