/**
 * `adcode __complete <words before the cursor...> @<word being completed>`
 *
 * The shell runs this on every Tab press, so it starts nothing it does not need: no desktop
 * profile, no account, no catalogue, no network. It prints one candidate per line.
 */
import process from "node:process";
import { completionCandidates, readCompletionCache } from "./completion/complete.ts";
import { HELP_COMMANDS } from "./commands/help.ts";
import { listSessions } from "./ai/sessions.ts";
import { themeNames } from "./tui/theme.ts";

const args = process.argv.slice(2);
if (args[0] === "__complete") args.shift();
const last = args[args.length - 1];
const current = last !== undefined && last.startsWith("@") ? last.slice(1) : "";
const before = last !== undefined && last.startsWith("@") ? args.slice(0, -1) : args;

try {
  const cache = readCompletionCache();
  const needsSessions = before.includes("--session") || before.includes("sessions");
  const candidates = completionCandidates(before, current, {
    commands: HELP_COMMANDS.map((entry) => entry.name),
    themes: themeNames(),
    models: cache.models,
    providers: cache.providers,
    sessions: needsSessions ? listSessions().map((session) => session.id) : [],
  });
  if (candidates.length > 0) process.stdout.write(`${candidates.join("\n")}\n`);
} catch {
  // A completion that fails offers nothing; it must never print an error into the prompt.
}
