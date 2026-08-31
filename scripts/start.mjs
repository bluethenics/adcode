/**
 * `npm start` - build if anything changed, then launch ADCode.
 *
 * The build takes about ninety seconds, which is fine once and intolerable every time.
 * So this compares the newest source file against the newest build output and only
 * rebuilds when it has to: the first run builds, and every run after it opens straight
 * away. `npm start -- --force` rebuilds regardless.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { validateOpenTarget } from "./openTarget.mjs";
import { createBuildProgress, quipAt, renderFrame, renderSummary } from "./buildProgress.mjs";

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
  join(REPO, "apps", "desktop", "tsconfig.json"),
  join(REPO, "package-lock.json"),
  join(REPO, "package.json"),
  join(REPO, "tsconfig.json"),
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

/* ── The build, with something to look at ─────────────────────────────── */

/**
 * What the last build cost, so the next one can draw an honest bar.
 *
 * In `.adcode-cache`, which is already ignored, and treated as a hint throughout: a
 * missing or corrupt file costs a less accurate first bar and nothing else.
 */
const PROGRESS_CACHE = join(REPO, ".adcode-cache", "build-progress.json");

async function readLearned() {
  try {
    const parsed = JSON.parse(await readFile(PROGRESS_CACHE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      durations: typeof parsed.durations === "object" ? (parsed.durations ?? {}) : {},
      modules: typeof parsed.modules === "object" ? (parsed.modules ?? {}) : {},
    };
  } catch {
    // No cache on a first run, which is exactly the build that has to guess.
    return {};
  }
}

async function writeLearned(learned) {
  try {
    await mkdir(dirname(PROGRESS_CACHE), { recursive: true });
    await writeFile(PROGRESS_CACHE, JSON.stringify(learned), "utf8");
  } catch {
    // Unwritable cache, less accurate bar next time. Never a reason not to launch.
  }
}

const CURSOR_HIDE = "\u001b[?25l";
const CURSOR_SHOW = "\u001b[?25h";

/**
 * Run the build, showing a progress bar instead of forty lines of Vite.
 *
 * The child is piped rather than inherited, which is what makes the bar possible and also
 * what costs us Vite's own `transforming` counter - it only prints that to a TTY. Every
 * line is kept, and printed in full if the build fails: a bar is a nicer way to wait, but
 * it is never a reason to be shown less when something breaks.
 */
function buildWithProgress(electronVite, known) {
  return new Promise((resolve, reject) => {
    const animated = process.stdout.isTTY === true;
    const colour = animated && process.env["NO_COLOR"] === undefined;

    const progress = createBuildProgress(known);
    const raw = [];
    let pending = "";
    let drawn = 0;
    let announced = "";

    function erase() {
      if (drawn === 0) return;
      // Up N lines, then clear everything below the cursor - one escape rather than a
      // clear per line, so a resize mid-build cannot leave half a frame behind.
      process.stdout.write(`\u001b[${drawn}A\u001b[0J`);
      drawn = 0;
    }

    function draw() {
      const state = progress.snapshot();

      if (!animated) {
        // No cursor to move, so say each phase once and stay quiet in between. This is
        // what CI and `npm start > log` see.
        if (state.label !== announced) {
          announced = state.label;
          process.stdout.write(`  Building ${state.label}…\n`);
        }
        return;
      }

      const lines = renderFrame({
        fraction: state.fraction,
        label: state.label,
        quip: quipAt(state.elapsedMs),
        elapsedMs: state.elapsedMs,
        columns: process.stdout.columns ?? 80,
        colour,
      });

      erase();
      process.stdout.write(`${lines.join("\n")}\n`);
      drawn = lines.length;
    }

    // Split on either ending: Vite rewrites its progress line with a bare carriage return,
    // so splitting on newlines alone would swallow it into an ever-growing buffer.
    function feed(chunk) {
      const text = chunk.toString();
      raw.push(text);
      pending += text;

      const lines = pending.split(/\r\n|\n|\r/);
      pending = lines.pop() ?? "";
      for (const line of lines) progress.push(line);
    }

    const child = spawn(process.execPath, [electronVite, "build"], {
      cwd: join(REPO, "apps", "desktop"),
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (animated) process.stdout.write(CURSOR_HIDE);
    const timer = setInterval(draw, 90);
    draw();

    function restore() {
      clearInterval(timer);
      erase();
      if (animated) process.stdout.write(CURSOR_SHOW);
    }

    // A cursor left hidden outlives this process and ruins the shell it was run from.
    const onInterrupt = () => {
      restore();
      child.kill();
      process.exit(130);
    };
    process.once("SIGINT", onInterrupt);

    child.stdout.on("data", feed);
    child.stderr.on("data", feed);

    child.once("error", (error) => {
      restore();
      process.removeListener("SIGINT", onInterrupt);
      reject(error);
    });

    child.once("exit", (code) => {
      if (pending.length > 0) progress.push(pending);
      const state = progress.snapshot();
      restore();
      process.removeListener("SIGINT", onInterrupt);

      if (code !== 0) {
        // Everything, exactly as Vite wrote it. This is the moment the bar was hiding
        // output for, and the moment it must stop.
        process.stderr.write(raw.join(""));
        resolve({ code: code ?? 1, learned: null });
        return;
      }

      process.stdout.write(`${renderSummary(state, colour)}\n`);
      if (state.warnings > 0) {
        const dim = colour ? "\u001b[2m" : "";
        const off = colour ? "\u001b[0m" : "";
        const plural = state.warnings === 1 ? "note" : "notes";
        process.stdout.write(
          `  ${dim}${state.warnings} bundler ${plural} hidden - npm start -- --verbose to read them${off}\n`,
        );
      }

      resolve({ code: 0, learned: progress.learned() });
    });
  });
}

/** Launcher flags, which are ours rather than something to open. */
const FLAGS = new Set(["--force", "--verbose"]);

const verbose = process.argv.includes("--verbose");
const requested = process.argv.slice(2).filter((argument) => !FLAGS.has(argument));
const openTarget = await validateOpenTarget(requested, REPO);
if (!openTarget.ok) {
  process.stderr.write(`${openTarget.message}\n`);
  process.exit(2);
}

if (await needsBuild()) {
  // Through the electron-vite entry script directly rather than `npm run`, so there is
  // one less shell between here and the build - `.cmd` shims and `spawn` disagree on
  // Windows. The bin is not in the package's `exports` map, so it is resolved by walking
  // up from `package.json` rather than by specifier.
  const electronVite = join(
    dirname(require.resolve("electron-vite/package.json")),
    "bin",
    "electron-vite.js",
  );

  if (verbose) {
    // Every line, unparsed and uninterrupted - the escape hatch for anyone debugging the
    // build itself rather than waiting for it.
    process.stdout.write("Building ADCode (first run, or sources changed)…\n");
    const code = await run(process.execPath, [electronVite, "build"], {
      cwd: join(REPO, "apps", "desktop"),
    });

    if (code !== 0) {
      process.stderr.write("\nBuild failed - not launching.\n");
      process.exit(code);
    }
  } else {
    const result = await buildWithProgress(electronVite, await readLearned());

    if (result.code !== 0) {
      process.stderr.write("\nBuild failed - not launching.\n");
      process.exit(result.code);
    }

    await writeLearned(result.learned);
  }
}

// The `electron` package's main export is the path to the real executable. The `.bin`
// shim is a `.cmd` on Windows and `spawn` refuses to run it.
const electronPath = require("electron");
process.stdout.write("Starting ADCode…\n");

const launchArguments = openTarget.target === null ? [] : ["--adcode-open", openTarget.target];
process.exit(await run(electronPath, [join(REPO, "apps", "desktop"), ...launchArguments]));
