#!/usr/bin/env node
/**
 * `adcode` - the one command for working on ADCode.
 *
 * The npm scripts still exist and still work; this is a name over the top of them. It
 * exists because `npm start` says nothing about what starts, `npm run web:deploy` is three
 * pieces of punctuation, and neither reads like a tool. `adcode open` does.
 *
 * Every subcommand below is a thin dispatch to the script that already did the job. There
 * is deliberately no logic here beyond choosing one - the moment this file starts building
 * things itself, there are two ways to build and they drift.
 *
 *   adcode              # the same as `adcode help`
 *   adcode open         # build the editor and open it
 *   adcode site         # run the website locally
 *
 * Install it with `npm link` from the repository root, once. After that `adcode` works
 * from any directory, and always acts on this checkout.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import process from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/**
 * The commands, in the order a person meets them.
 *
 * `script` is the npm script it runs. Nothing here shells out to anything that is not in
 * this repository's own package.json.
 */
const COMMANDS = [
  { name: "open", script: "start", blurb: "Open the complete editor, optionally at a path" },
  { name: "dev", script: "dev", blurb: "Open the editor with reloading, for working on it" },
  { name: "site", script: "web", blurb: "Run the website on http://localhost:3000" },
  { name: "build", script: "desktop:build", blurb: "Build the editor without opening it" },
  { name: "installer", script: "package", blurb: "Build a signed-shaped installer into release/" },
  { name: "check", script: "verify", blurb: "Types, the dependency firewall, and every test" },
  { name: "test", script: "test", blurb: "Just the tests" },
  { name: "smoke", script: "smoke", blurb: "Drive the built editor and assert what a person would see" },
  { name: "ship", script: "web:deploy", blurb: "Build the site and deploy it to Cloudflare" },
  { name: "icons", script: "icons", blurb: "Redraw the application icons" },
];

const HELP = `ADCode ${version}

  adcode <command>

${COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.blurb}`).join("\n")}
  help       This
  version    ${version}

Anything after the command is passed straight through, so
  adcode open .
opens the current folder with every built-in ADCode feature, and
  adcode test services/api
runs only those tests.
`;

const [, , name = "help", ...rest] = process.argv;

if (name === "help" || name === "--help" || name === "-h") {
  process.stdout.write(HELP);
  process.exit(0);
}

if (name === "version" || name === "--version" || name === "-v") {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const command = COMMANDS.find((c) => c.name === name);

if (command === undefined) {
  // Name the closest thing rather than only complaining: a typo is the likeliest reason to
  // be here, and the list is short enough that the nearest match is nearly always right.
  const near = COMMANDS.map((c) => c.name).filter((c) => c.startsWith(name[0] ?? ""));
  process.stderr.write(`adcode: there is no "${name}" command.\n`);
  if (near.length > 0) process.stderr.write(`Did you mean: ${near.join(", ")}?\n`);
  process.stderr.write(`Run "adcode help" for the list.\n`);
  process.exit(2);
}

const windows = process.platform === "win32";

/**
 * Quote an argument for `cmd.exe`.
 *
 * Only used on Windows, and only because it has to be: npm there is `npm.cmd`, and since
 * the batch-file argument injection fix Node refuses to spawn a `.cmd` without a shell -
 * it throws `EINVAL` rather than running it. A shell means the arguments are re-parsed,
 * so anything with a space in it has to survive that on purpose rather than by luck.
 */
const quote = (argument) => (/[\s"&|<>^%]/.test(argument) ? `"${argument.replace(/"/g, '""')}"` : argument);

// `adcode` always runs npm from its own checkout. Resolve an open target before changing
// directory so `adcode open .` means the caller's project, not ADCode's source directory.
const forwarded = command.name === "open" && rest[0] !== undefined
  ? [resolve(process.cwd(), rest[0]), ...rest.slice(1)]
  : rest;
const args = ["run", command.script, ...(forwarded.length > 0 ? ["--", ...forwarded] : [])];

const child = spawn(windows ? "npm.cmd" : "npm", windows ? args.map(quote) : args, {
  cwd: ROOT,
  stdio: "inherit",
  shell: windows,
});

child.once("error", (error) => {
  process.stderr.write(`adcode: could not run npm - ${error.message}\n`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  // A signalled child has no exit code. Report something non-zero rather than a silent 0.
  process.exit(signal !== null ? 1 : (code ?? 0));
});
