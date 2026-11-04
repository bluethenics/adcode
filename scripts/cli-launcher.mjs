import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEVELOPER_COMMANDS = {
  dev: "dev", site: "web", build: "desktop:build", installer: "package",
  check: "verify", test: "test", smoke: "smoke", ship: "web:deploy", icons: "icons",
};
const VALUE_FLAGS = new Set(["--theme", "--width", "--height", "--provider", "--model", "--session", "--effort"]);

/** Find npm's JavaScript entry point, so Windows paths never need shell quoting. */
function npmEntry(env) {
  const candidates = [
    env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean).flatMap((directory) => [
      join(directory, "node_modules/npm/bin/npm-cli.js"),
      join(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
    ]),
  ];
  const entry = candidates.find((candidate) => candidate && /npm-cli\.[cm]?js$/.test(candidate) && existsSync(candidate));
  if (entry === undefined) throw new Error("npm could not be found. Install Node.js 24 or newer with npm, then try again.");
  return entry;
}

/** An inspectable plan also powers `adcode app --json` without opening a window. */
export function createLaunchPlan(argv, options = {}) {
  const caller = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  let commandIndex = -1;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") break;
    if (!argument.startsWith("-")) { commandIndex = index; break; }
    if (VALUE_FLAGS.has(argument)) index += 1;
  }
  const command = argv[commandIndex] ?? "deck";
  const desktop = command === "app" || command === "open";
  const developer = Object.hasOwn(DEVELOPER_COMMANDS, command);
  const boundary = argv.indexOf("--");
  const optionArguments = boundary < 0 ? argv : argv.slice(0, boundary);
  const help = optionArguments.includes("--help") || optionArguments.includes("-h");
  const base = { command, executable: process.execPath, cwd: caller, preview: false };
  if ((!desktop && !developer) || help) {
    return { ...base, kind: "terminal", args: [join(ROOT, "apps/cli/src/index.ts"), ...argv] };
  }

  const rest = argv.filter((_, index) => index !== commandIndex);
  const literalIndex = rest.indexOf("--");
  const optionsEnd = literalIndex < 0 ? rest.length : literalIndex;
  const preview = rest.slice(0, optionsEnd).some((argument) => argument === "--dry-run" || argument === "--json");
  const forwarded = rest.filter((argument, index) => index >= optionsEnd || (argument !== "--dry-run" && argument !== "--json"));
  if (desktop) {
    const flags = new Set(["--force", "--verbose"]);
    const targets = [];
    const launchFlags = [];
    let literal = false;
    for (const argument of forwarded) {
      if (!literal && argument === "--") { literal = true; continue; }
      if (!literal && flags.has(argument)) { launchFlags.push(argument); continue; }
      if (!literal && argument.startsWith("-")) throw new Error(`Unknown app option "${argument}". Run adcode app --help.`);
      targets.push(argument);
    }
    if (targets.length > 1) throw new Error("adcode app accepts one file or folder. Run adcode app --help.");
    const target = resolve(caller, targets[0] ?? ".");
    if (!existsSync(target)) throw new Error(`The path does not exist: ${target}`);
    return { ...base, kind: "desktop", cwd: ROOT, preview, target,
      args: [join(ROOT, "scripts/start.mjs"), ...launchFlags, target] };
  }
  return { ...base, kind: "developer", cwd: ROOT, preview,
    args: [npmEntry(env), "run", DEVELOPER_COMMANDS[command], ...(forwarded.length > 0 ? ["--", ...forwarded] : [])] };
}
