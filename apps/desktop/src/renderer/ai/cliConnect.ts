/**
 * One button to connect a coding CLI.
 *
 * The CLI tab, Move in and the welcome tour used to offer a row of buttons per tool - Install,
 * Sign in, Use, Choose its model - and leave the person to work out the order. This decides
 * the one step that is next and does it:
 *
 *  - found and able to answer in the chat: it becomes ADCode's model at once (its own default
 *    model), so Connect is the whole job;
 *  - found but terminal-only (Freebuff): it opens in a terminal tab beside the code;
 *  - not found: one terminal command installs it and then starts its sign-in, and ADCode looks
 *    again by itself when the person comes back to the window.
 *
 * The plan is pure, so what each button will do is tested rather than discovered.
 */
import type { AiProviderInfo } from "../../shared/api.ts";

export type CliConnectPlan =
  | { readonly kind: "use"; readonly provider: string; readonly model: string; readonly label: string }
  | { readonly kind: "terminal"; readonly command: string; readonly label: string; readonly then: "open" | "install" }
  | { readonly kind: "unavailable"; readonly label: string };

export function cliConnectPlan(provider: AiProviderInfo, activeProvider: string | null): CliConnectPlan {
  const cli = provider.cli;
  if (cli === undefined) return { kind: "unavailable", label: "Not a coding CLI" };
  if (cli.installed && cli.headless) {
    const model = provider.models.find((item) => item.recommended)?.id ?? provider.models[0]?.id ?? "default";
    return { kind: "use", provider: provider.id, model, label: activeProvider === provider.id ? "Connected" : "Connect" };
  }
  if (cli.installed) return { kind: "terminal", command: cli.command, label: "Open", then: "open" };
  // `&&`, so a failed install never runs a sign-in for a program that is not there. Both
  // commands come from ADCode's own list (packages/ai cliAgents.ts), never from the page.
  return { kind: "terminal", command: `${cli.install} && ${cli.signIn}`, label: "Connect", then: "install" };
}

export interface CliConnectDeps {
  readonly write: (id: string, value: string) => Promise<unknown>;
  readonly runInTerminal: (command: string) => void;
}

/** Carry the plan out. Resolves to a sentence saying what happened, for the status line. */
export async function connectCli(plan: CliConnectPlan, name: string, deps: CliConnectDeps): Promise<string> {
  if (plan.kind === "use") {
    await deps.write("adcode.ai.provider", plan.provider);
    await deps.write("adcode.ai.model", plan.model);
    return `${name} is connected. It answers in the chat with its own account.`;
  }
  if (plan.kind === "terminal") {
    deps.runInTerminal(plan.command);
    return plan.then === "open"
      ? `${name} is opening in a terminal tab.`
      : `Installing ${name} in a terminal tab, then signing in. Come back here when it is done - ADCode looks again by itself.`;
  }
  return `${name} cannot be connected here.`;
}
