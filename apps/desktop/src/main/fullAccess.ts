/**
 * Full access: the person's explicit "do whatever it takes" for the assistant.
 *
 * It is one setting, off by default, but where it applies matters. Every confirmation
 * ADCode shows goes through `confirmInWindow`, including the tool bridge's - another
 * program on this computer asking ADCode to do something. If full access were a plain
 * global flag, a chat the person trusted would silently open the door for that program too.
 *
 * So the mode is scoped to an *agent turn*: the async work of one chat message, or of an
 * agent/Team run started by ADCode itself. `runAgentTurn` marks that work; the async store
 * follows every await, helper and tool call inside it, and nothing outside it. The bridge
 * and app startup stay outside and keep asking.
 *
 * The setting is read when a dialog would be shown, not once at the start: switching full
 * access off while a long turn is running brings the dialogs back for the rest of it.
 *
 * Plain Node, no Electron and no settings import, so the scope itself is testable.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const agentTurn = new AsyncLocalStorage<true>();

/** Run one chat turn, or one ADCode-started agent run, with full access available to it. */
export function runAgentTurn<T>(work: () => T): T {
  return agentTurn.run(true, work);
}

/** Whether this work belongs to an ADCode agent turn rather than the bridge or app startup. */
export function inAgentTurn(): boolean {
  return agentTurn.getStore() === true;
}

/**
 * The setting's exact value, in one place.
 *
 * Only a real boolean `true` counts. A string "true" from an imported or hand-edited
 * settings file must not quietly grant the assistant permission to skip every dialog.
 */
export function isFullAccessOn(values: Readonly<Record<string, unknown>>): boolean {
  return values["adcode.ai.fullAccess"] === true;
}

/**
 * The whole rule in one place: the person switched full access on, and this work is one of
 * ADCode's own agent turns. Every confirmation and edit-policy decision asks this, so the
 * two halves cannot drift apart.
 */
export function fullAccessApplies(
  values: Readonly<Record<string, unknown>>,
  inTurn: boolean = inAgentTurn(),
): boolean {
  return inTurn && isFullAccessOn(values);
}
