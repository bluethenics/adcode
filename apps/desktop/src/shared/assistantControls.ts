/** Serializable assistant controls; no privileged imports in the renderer. */

/** How the app talks to a connector: a program it starts, or an address it calls. */
export type AssistantTransport = "stdio" | "http" | "sse";

/**
 * What a saved connector is, for the badge and the card.
 *
 * `mcp` and `openapi` are the live kinds; `extension` (Claude Desktop `.mcpb`) and
 * `plugin` (Claude Code plugin) are MCP servers underneath that remembered where they
 * came from, so their files can be updated or removed as a unit.
 */
export type AssistantConnectorKind = "mcp" | "openapi" | "extension" | "plugin";

/** Where a connector came from, so the card can say it plainly. */
export type AssistantConnectorOrigin = "custom" | "import" | "extension" | "plugin" | "actions";

/** How an OpenAPI connector authenticates; reduced from whatever the source said. */
export interface AssistantAuthInput {
  readonly kind: "none" | "bearer" | "header" | "query";
  readonly name: string | null;
  readonly needsToken: boolean;
}

/** What the renderer sends to save a connector by hand. Everything else has a default. */
export interface AssistantServerInput {
  readonly id: string;
  readonly name: string;
  readonly transport: AssistantTransport;
  readonly endpoint: string;
  readonly args: readonly string[];
}

/** A saved connector. Values never appear here - only the names of the stored ones. */
export interface AssistantServerRecord extends AssistantServerInput {
  readonly kind: AssistantConnectorKind;
  readonly origin: AssistantConnectorOrigin;
  /** The app or file it was added from, e.g. "Claude Desktop" or "Added by hand". */
  readonly source: string;
  /** One plain sentence about what it lets the assistant do. */
  readonly purpose: string;
  /** Names of the values held in the encrypted store for this connector. */
  readonly valueKeys: readonly string[];
  /** OpenAPI connectors only: the API description itself. */
  readonly spec: string | null;
  readonly auth: AssistantAuthInput | null;
  readonly homepage: string | null;
  /** Extensions and plugins: where their files were installed. */
  readonly root: string | null;
  readonly version: string | null;
}

export interface AssistantServerView extends AssistantServerRecord {
  readonly status: "disconnected" | "connecting" | "connected" | "error";
  readonly error: string | null;
  /** OAuth: "required" offers Sign in on the card; "signed-in" when requests carry a token. */
  readonly oauth: "required" | "signed-in" | null;
  /** Which stored values are present, so the card can ask for the missing one. */
  readonly values: readonly { readonly key: string; readonly secret: boolean }[];
  readonly tools: readonly {
    name: string;
    description: string;
    enabled: boolean;
    calls: number;
    lastDurationMs: number | null;
    lastError: string | null;
  }[];
}

/** One question an imported connector asks before it can work. */
export interface ConnectorValueAsk {
  readonly key: string;
  readonly label: string;
  readonly hint: string | null;
  readonly required: boolean;
  readonly secret: boolean;
  readonly preset: string | null;
}

/** An outside format, read and ready to add, as the Add dialog shows it. */
export interface ConnectorDraftView {
  /** Opaque ID the add action refers back to; never a path or URL. */
  readonly handle: string;
  readonly kind: AssistantConnectorKind;
  readonly name: string;
  readonly slug: string;
  readonly purpose: string;
  readonly source: string;
  readonly origin: AssistantConnectorOrigin;
  readonly transport: AssistantTransport;
  readonly endpoint: string;
  readonly values: readonly ConnectorValueAsk[];
  readonly warnings: readonly string[];
  readonly homepage: string | null;
  /** Plugin drafts only: the skills the plugin carries. */
  readonly skills: readonly string[];
  /** Plugin drafts only: MCP servers the plugin declares. */
  readonly servers: readonly { readonly name: string; readonly transport: AssistantTransport }[];
  /** OpenAPI drafts only: how many operations the description holds. */
  readonly operations: number;
  readonly version: string | null;
  /** False when the source needs its files (a lone plugin.json, a bare manifest). */
  readonly installable: boolean;
  /** Why it cannot be added, when it cannot. */
  readonly problem: string | null;
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
  /** The person's ordering: pinned skills are offered first, low ones last (`skillOrder.ts`). */
  readonly rank: "pinned" | "normal" | "low";
}

export interface AssistantControlsView {
  readonly workspace: string | null;
  readonly servers: readonly AssistantServerView[];
  readonly skills: readonly AssistantSkillView[];
  /** Imported things waiting to be looked at and added. */
  readonly drafts: readonly ConnectorDraftView[];
  readonly notice: string | null;
}

export type AssistantControlAction =
  | { readonly kind: "create-skill"; readonly name: string; readonly description: string; readonly instructions: string }
  | { readonly kind: "save-server"; readonly server: unknown; readonly values?: Readonly<Record<string, string>> }
  | { readonly kind: "connect" | "disconnect" | "remove-server" | "forget-values" | "sign-in" | "sign-out"; readonly id: string }
  | { readonly kind: "set-tool"; readonly id: string; readonly tool: string; readonly enabled: boolean }
  | { readonly kind: "set-skill"; readonly id: string; readonly enabled: boolean }
  /** Turn several skills on or off in one step, e.g. everything one tool brought. */
  | { readonly kind: "set-skills"; readonly ids: readonly string[]; readonly enabled: boolean }
  | { readonly kind: "rank-skill"; readonly id: string; readonly rank: "pinned" | "normal" | "low" }
  | { readonly kind: "scan-imports" }
  | { readonly kind: "import-path" | "import-url"; readonly from: string }
  | { readonly kind: "import-text"; readonly text: string; readonly fileName?: string | null }
  | { readonly kind: "discard-draft"; readonly handle: string }
  | { readonly kind: "add-draft"; readonly handle: string; readonly values: Readonly<Record<string, string>> };
