/**
 * `npm run package` - build ADCode, then wrap it in an installer.
 *
 * Always build first. Packaging stale output can create an installer that works only on
 * the development machine and fails after distribution.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { azureCredentialsPresent, azureSignArgs } from "./azure-sign-args.mjs";
import { releaseDirectory } from "./release-directory.mjs";

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

process.stdout.write("Building ADCode...\n");

const grammars = await run(process.execPath, [join(REPO, "scripts", "grammars.mjs"), "--strict"]);
if (grammars !== 0) process.exit(grammars);

const build = await run(process.execPath, [binOf("electron-vite", "bin", "electron-vite.js"), "build"], {
  cwd: join(REPO, "apps", "desktop"),
});

if (build !== 0) {
  process.stderr.write("\nBuild failed - not packaging.\n");
  process.exit(build);
}

process.stdout.write("\nPackaging...\n");

// Anything after `--` is passed through, so `npm run package -- --linux` works.
const passthrough = process.argv.slice(2);
const output = releaseDirectory(REPO);
if (output !== join(REPO, "release")) {
  process.stdout.write(
    `\nWriting the installers to ${output}.\n` +
      `Set ADCODE_RELEASE_DIR to choose somewhere else.\n`,
  );
}

// Azure Trusted Signing is opt-in per build: the four ADCODE_AZURE_* identifiers turn
// on `win.azureSignOptions`, and the AZURE_* credentials must be there to back it -
// otherwise the failure would arrive ten minutes into packaging as an auth error.
const azureArgs = azureSignArgs(process.env);
if (azureArgs.length > 0 && !azureCredentialsPresent(process.env)) {
  process.stderr.write(
    "\nAzure signing identifiers are set but AZURE_TENANT_ID, AZURE_CLIENT_ID and " +
      "AZURE_CLIENT_SECRET are not all present. Unset the identifiers for an unsigned " +
      "build, or provide the credentials.\n",
  );
  process.exit(1);
}
if (azureArgs.length > 0) {
  process.stdout.write("\nSigning Windows builds with Azure Trusted Signing.\n");
}

process.exit(
  await run(process.execPath, [
    binOf("electron-builder", "cli.js"),
    `-c.directories.output=${output}`,
    ...azureArgs,
    ...passthrough,
  ]),
);
