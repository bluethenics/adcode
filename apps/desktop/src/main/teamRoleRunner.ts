/**
 * The tool runner a Team role works through: the ordinary file tools, plus its teammates.
 *
 * Wraps the role's isolated-workspace runner with three things a team needs while it works:
 *
 * - `message_teammate` and `read_messages`, backed by the team's mailbox;
 * - delivery: unread messages ride along with the result of whatever tool the role runs next,
 *   so a message arrives mid-run without the agent having to poll for it;
 * - overlap: when a role edits a file a teammate already edited, the result says who - each
 *   role works in its own copy, so finding out at the merge is too late.
 *
 * Messages and overlaps are also reported live, for the chat's live room to animate. Nothing
 * here is decoration: every animation is one of these events actually happening.
 */
import {
  formatInbox,
  recipientProblem,
  type OverlapTracker,
  type TeamMailbox,
  type ToolRunner,
  type ToolRunResult,
} from "@adcode/ai";
import type { LiveEventView } from "../shared/liveAgents.ts";

export interface TeamRoleRunnerOptions {
  readonly inner: ToolRunner;
  readonly teamId: string;
  readonly roleId: string;
  /** Every role id on the team, this one included. */
  readonly roster: readonly string[];
  labelFor(roleId: string): string;
  readonly mailbox: TeamMailbox;
  /** Null for a solo run, which has no teammates to collide with. */
  readonly overlaps: OverlapTracker | null;
  /** False for a solo run: no teammates, so no team tools and no inbox. */
  readonly teamTools: boolean;
  now(): number;
  onLive(event: LiveEventView): void;
}

const EDIT_TOOLS = new Set(["edit_file", "propose_edit"]);

const fail = (content: string): ToolRunResult => ({ content, isError: true });

export function createTeamRoleRunner(options: TeamRoleRunnerOptions): ToolRunner {
  const { inner, teamId, roleId, mailbox } = options;

  function withInbox(result: ToolRunResult): ToolRunResult {
    if (!options.teamTools) return result;
    const unread = mailbox.take(teamId, roleId);
    if (unread.length === 0) return result;
    return { ...result, content: `${result.content}\n\n${formatInbox(unread, options.labelFor)}` };
  }

  return {
    async run(call, signal) {
      if (call.name === "message_teammate" || call.name === "read_messages") {
        if (!options.teamTools) return fail(`${call.name} is only available on a Team.`);
        if (call.name === "read_messages") {
          return { content: formatInbox(mailbox.take(teamId, roleId), options.labelFor), isError: false };
        }
        const to = typeof call.input["to"] === "string" ? call.input["to"].trim() : "";
        const text = typeof call.input["text"] === "string" ? call.input["text"].trim() : "";
        if (text.length === 0) return fail("message_teammate needs some text.");
        const problem = recipientProblem(to, roleId, options.roster);
        if (problem !== null) return fail(problem);
        const sent = mailbox.post(teamId, roleId, to, text, options.now());
        options.onLive({ kind: "message", to, text: sent.text });
        return withInbox({ content: `Sent to ${to === "all" ? "the whole team" : options.labelFor(to)}.`, isError: false });
      }

      const result = await inner.run(call, signal);
      const path = call.input["path"];
      if (options.overlaps !== null && EDIT_TOOLS.has(call.name) && !result.isError && typeof path === "string") {
        const other = options.overlaps.touch(teamId, roleId, path);
        if (other !== null) {
          options.onLive({ kind: "overlap", withRole: other, path });
          return withInbox({
            ...result,
            content: `${result.content}\n\nHeads up: ${options.labelFor(other)} also edited ${path} in their copy. Message them with message_teammate to agree who changes what, or the merge will conflict.`,
          });
        }
      }
      return withInbox(result);
    },
  };
}
