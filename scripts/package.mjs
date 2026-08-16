/**
 * `npm run package` - build ADCode, then wrap it in an installer.
 *
 * Always a fresh build first. Packaging a stale `out/` produces an installer that works
 * on this machine and nowhere else, and the failure only shows up on someone else's.
 */
import { spawn } from "node:child_process";
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

process.stdout.write("\nPackaging…\n");

// Anything after `--` is passed through, so `npm run package -- --linux` works.
const passthrough = process.argv.slice(2);

process.exit(
  await run(process.execPath, [binOf("electron-builder", "cli.js"), ...passthrough]),
);
