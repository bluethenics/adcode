/** Intent-level access to complex Assistant controls, shared by buttons and commands. */
export type ChatWidgetIntent = "team" | "schedule";

export interface ChatWidgetIntentActions {
  readonly open: () => void;
  readonly showTeam: () => void;
  readonly showSchedule: () => void;
}

/** Always make the Assistant visible before revealing the requested confirmed flow. */
export function runChatWidgetIntent(
  intent: ChatWidgetIntent,
  actions: ChatWidgetIntentActions,
): void {
  actions.open();
  if (intent === "team") actions.showTeam();
  else actions.showSchedule();
}
