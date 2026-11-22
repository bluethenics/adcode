/**
 * Five agents a new user can run straight away, on whatever model they connected.
 *
 * Seeded once, the first time the Agents page opens with no saved agents. After that they are
 * ordinary saved agents: edit them, delete them - deleting all of them does not bring them back.
 */
import type { AgentProfile } from "../ai/agentProfiles.ts";

/**
 * Set in localStorage once the starters had been offered (until 22 Nov 2026). Still read on the
 * desktop, where it means the list it guarded was saved; see `shouldSeedStarters`.
 */
export const STARTERS_MARKER = "adcode.agents.starters.v1";
/** Set in localStorage when the person empties the agent list; removed when it has agents again. */
export const EMPTIED_MARKER = "adcode.agents.emptied.v1";

/**
 * Whether to add the starters now.
 *
 * Not "were they ever offered": on the web the saved list lives in the browser host's files,
 * written to IndexedDB a moment after each change, while that note went to localStorage at once.
 * A reload in between kept the note and lost the agents, and the page never offered them again
 * (found 22 Nov 2026). So the question is whether the person emptied the list themselves - a
 * note written only after their own deletion is saved, so losing a save can only bring agents
 * back, never take them away. The old note still counts on the desktop, whose settings are
 * saved before the write returns; on the web it cannot tell a deletion from a lost save.
 */
export function shouldSeedStarters(state: { readonly agents: number; readonly emptied: boolean; readonly offeredBefore: boolean; readonly web: boolean }): boolean {
  if (state.agents > 0 || state.emptied) return false;
  return state.web || !state.offeredBefore;
}

export function starterAgents(route: { readonly provider: string; readonly model: string; readonly useCurrentModel?: boolean }): AgentProfile[] {
  const agent = (id: string, name: string, instructions: string, look: AgentProfile["mascot"], extra: Partial<AgentProfile> = {}): AgentProfile => ({
    id,
    name,
    instructions,
    provider: route.provider,
    model: route.model,
    ...(route.useCurrentModel ? { useCurrentModel: true } : {}),
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
