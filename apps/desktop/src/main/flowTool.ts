/**
 * `manage_agent_flow` in the desktop app: the plan from `@adcode/ai` (agentFlowTool.ts), the
 * person's yes in the app's own dialog, then the same setting the Flow page writes. The page
 * listens for that setting, so a flow made in the chat is on the page the moment it is saved.
 *
 * Plain Node, no Electron: ai.ts hands in the dialog, the settings and the debug log, so the
 * whole path - call, confirmation, saved flow - runs in a unit test.
 */
import { MANAGE_AGENT_FLOW_NAME, flowsSettingValue, planFlowChange, type FlowChat, type ModelCandidate, type ToolRunner } from "@adcode/ai";
import { readFlows } from "@adcode/ai/agentFlow";

export const FLOWS_SETTING = "adcode.ai.agentFlows";

export interface FlowToolDeps {
  readonly settings: () => Readonly<Record<string, unknown>>;
  readonly writeSetting: (id: string, value: string) => Promise<unknown>;
  readonly candidates: () => Promise<readonly ModelCandidate[]>;
  /** The chat the call came from. */
  readonly chatId: () => string | null;
  /** This project's saved chats, so "the refactor chat" can be named. */
  readonly chats?: () => Promise<readonly FlowChat[]>;
  readonly confirm: (ask: { readonly title: string; readonly body: string; readonly confirmLabel: string }, signal: AbortSignal) => Promise<boolean>;
  readonly record: (message: string) => void;
}

export function withFlowTool(base: ToolRunner, deps: FlowToolDeps): ToolRunner {
  return {
    async run(call, signal) {
      if (call.name !== MANAGE_AGENT_FLOW_NAME) return base.run(call, signal);
      if (signal.aborted) return { content: "Cancelled.", isError: true };
      const flows = readFlows(deps.settings()[FLOWS_SETTING]);
      const basis = flowsSettingValue(flows);
      const plan = planFlowChange(call.input, {
        flows,
        candidates: await deps.candidates().catch(() => []),
        chatId: deps.chatId(),
        ...(deps.chats === undefined ? {} : { chats: await deps.chats().catch(() => []) }),
      });
      if (!plan.ok) return { content: plan.message, isError: true };
      if (plan.kind === "answer") return { content: plan.content, isError: false };
      const allowed = await deps.confirm({ title: plan.title, body: plan.detail, confirmLabel: plan.confirmLabel }, signal);
      if (!allowed) {
        deps.record(`Declined agent flow change: ${plan.title}`);
        return { content: "The user declined, so nothing changed. Ask what they would like instead.", isError: true };
      }
      // The person may have changed a flow on the Flow page while the dialog was open: saving
      // the plan then would quietly undo their edit, so nothing is saved and the chat re-reads.
      if (flowsSettingValue(readFlows(deps.settings()[FLOWS_SETTING])) !== basis) {
        return { content: "The flows changed on the Flow page while the dialog was open, so nothing was saved. Call list, then make the change again.", isError: true };
      }
      await deps.writeSetting(FLOWS_SETTING, flowsSettingValue(plan.flows));
      deps.record(plan.log);
      return { content: plan.done, isError: false };
    },
  };
}
