/** Serializable assistant controls; no privileged imports in the renderer. */
export interface AssistantServerInput {
  readonly id: string;
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly endpoint: string;
  readonly args: readonly string[];
}

export interface AssistantServerView extends AssistantServerInput {
  readonly status: "disconnected" | "connecting" | "connected" | "error";
  readonly error: string | null;
  readonly tools: readonly {
    name: string;
    description: string;
    enabled: boolean;
    calls: number;
    lastDurationMs: number | null;
    lastError: string | null;
  }[];
}

export interface AssistantSkillView {
  readonly scope: "workspace" | "system";
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly error: string | null;
  readonly estimatedTokens: number;
}

export interface AssistantControlsView {
  readonly workspace: string | null;
  readonly servers: readonly AssistantServerView[];
  readonly skills: readonly AssistantSkillView[];
  readonly notice: string | null;
}

export type AssistantControlAction =
  | { readonly kind: "create-skill"; readonly name: string; readonly description: string; readonly instructions: string }
  | { readonly kind: "save-server"; readonly server: AssistantServerInput }
  | { readonly kind: "connect" | "disconnect" | "remove-server"; readonly id: string }
  | { readonly kind: "set-tool"; readonly id: string; readonly tool: string; readonly enabled: boolean }
  | { readonly kind: "set-skill"; readonly id: string; readonly enabled: boolean };
