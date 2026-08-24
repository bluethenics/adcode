/**
 * `npm run package` - build ADCode, then wrap it in an installer.
 *
 * Always a fresh build first. Packaging a stale `out/` produces an installer that works
 * on this machine and nowhere else, and the failure only shows up on someone else's.
 */
import { spawn, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));

/** Run a command and resolve with its exit code. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 0));
  });
}

/** A package's bin script, resolved without going through its `exports` map. */
const binOf = (pkg, ...parts) =>
  join(dirname(require.resolve(`${pkg}/package.json`)), ...parts);

process.stdout.write("Building ADCode…\n");

const build = await run(process.execPath, [binOf("electron-vite", "bin", "electron-vite.js"), "build"], {
  cwd: join(REPO, "apps", "desktop"),
});

if (build !== 0) {
  process.stderr.write("\nBuild failed - not packaging.\n");
  process.exit(build);
}

/**
 * Where the installers are written.
 *
 * Normally `release/` beside the source, which is what you want. But electron-builder holds
 * a lock on its output directory with `proper-lockfile`, which keeps that lock alive by
 * rewriting its mtime and reading it back to check it still owns it. FAT32 stores mtimes to
 * the nearest **two seconds**, so the value read back is not the value written, the library
 * decides the lock went stale, and packaging dies on `Unable to update lock within the
 * stale threshold` - a message that says nothing about filesystems and sends you looking at
 * antivirus and open file handles instead.
 *
 * This checkout can legitimately live on a FAT32 volume - the same limitation is why this
 * repository cannot use npm workspaces - so detect it and write somewhere with a real
 * filesystem rather than failing. `ADCODE_RELEASE_DIR` overrides either way.
 */
function outputDirectory() {
  const override = process.env["ADCODE_RELEASE_DIR"];
  if (typeof override === "string" && override.length > 0) return override;
  if (process.platform !== "win32") return null;

  const drive = REPO.slice(0, 2);
  let volume = "";
  try {
    volume = execFileSync("fsutil", ["fsinfo", "volumeinfo", drive], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // `fsutil fsinfo volumeinfo` needs no elevation, but if it is missing or refuses, carry
    // on and let electron-builder try. A wrong guess must not stop a build that would work.
    return null;
  }

  if (!/File System Name\s*:\s*(FAT|exFAT)/i.test(volume)) return null;

  const fallback = join(process.env["LOCALAPPDATA"] ?? REPO, "adcode", "release");
  process.stdout.write(
    `\n${drive} is FAT, which cannot hold electron-builder's lock reliably.\n` +
      `Writing the installers to ${fallback} instead.\n` +
      `Set ADCODE_RELEASE_DIR to choose somewhere else.\n`,
  );
  return fallback;
}

process.stdout.write("\nPackaging…\n");

// Anything after `--` is passed through, so `npm run package -- --linux` works.
const passthrough = process.argv.slice(2);
const output = outputDirectory();

process.exit(
  await run(process.execPath, [
    binOf("electron-builder", "cli.js"),
    ...(output === null ? [] : [`-c.directories.output=${output}`]),
    ...passthrough,
  ]),
);
