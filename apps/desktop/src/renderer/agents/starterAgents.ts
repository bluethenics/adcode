/**
 * Five agents a new user can run straight away, on whatever model they connected.
 *
 * Seeded once, the first time the Agents page opens with no saved agents. After that they are
 * ordinary saved agents: edit them, delete them - deleting all of them does not bring them back.
 */
import type { AgentProfile } from "../ai/agentProfiles.ts";

/** Set in localStorage once the starters have been offered, so they are never re-added. */
export const STARTERS_MARKER = "adcode.agents.starters.v1";

export function starterAgents(route: { readonly provider: string; readonly model: string }): AgentProfile[] {
  const agent = (id: string, name: string, instructions: string, look: AgentProfile["mascot"], extra: Partial<AgentProfile> = {}): AgentProfile => ({
    id,
    name,
    instructions,
    provider: route.provider,
    model: route.model,
    ...(look === undefined ? {} : { mascot: look }),
    ...extra,
  });
  return [
    agent("starter-reviewer", "Reviewer", "Read the code involved in the task and report bugs, risky changes, missing tests and unclear names, most serious first. Point to the exact file and line. Do not change files.", { shape: "hexagon", color: "violet" }, { toolAccess: "read-only" }),
    agent("starter-tester", "Tester", "Write or extend automated tests for the task using the project's existing test framework and style. Run them, fix the tests you wrote until they pass, and report anything in the code under test that looks wrong.", { shape: "capsule", color: "green" }),
    agent("starter-ui-polish", "UI polish", "Improve the look and feel of the screens involved: spacing, alignment, type sizes, colour contrast, hover and focus states, and small-screen layout. Keep the existing design language and change nothing about behaviour.", { shape: "cloud", color: "pink" }),
    agent("starter-bug-fixer", "Bug fixer", "Reproduce the problem, find the root cause and make the smallest fix that solves it. Add a test that fails without the fix when the project has tests. Explain the cause in one or two sentences.", { shape: "drop", color: "coral" }),
    agent("starter-docs-writer", "Docs writer", "Write or update the documentation for the task: README sections, usage examples and code comments where the why is not obvious. Plain words, short sentences, real examples.", { shape: "egg", color: "amber" }),
  ];
}
