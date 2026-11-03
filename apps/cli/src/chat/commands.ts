/**
 * One catalogue for every place a slash command is offered.
 *
 * The palette, the key handler and the help text all read this list, so a command cannot
 * exist in one surface and be missing from another. It is deliberately short: the point of
 * a palette is a decision, not an inventory.
 */

export interface SlashCommand {
  readonly command: string;
  readonly blurb: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: "/model", blurb: "choose what answers next" },
  { command: "/new", blurb: "start a fresh conversation" },
  { command: "/sessions", blurb: "where this conversation is saved" },
  { command: "/status", blurb: "account, model and ad state" },
  { command: "/earn", blurb: "balance and ad cadence" },
  { command: "/theme", blurb: "switch the palette" },
  { command: "/help", blurb: "commands and keys" },
  { command: "/quit", blurb: "save and leave" },
];

/**
 * The palette filters on the command name alone. A query with an argument (`/model qwen`)
 * is intent to run the command, not to browse, so it stops matching.
 */
export function slashMatches(input: string): readonly SlashCommand[] {
  const query = (input.startsWith("/") ? input.slice(1) : input).trim().toLowerCase();
  if (query.includes(" ")) return [];
  return SLASH_COMMANDS.filter((entry) => entry.command.slice(1).startsWith(query));
}

export function slashHint(): string {
  return SLASH_COMMANDS.map((entry) => entry.command).join(" · ");
}
