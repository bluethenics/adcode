/**
 * The MCP server exposing the memory store.
 *
 * Brief §5.2: "Expose exactly these tools, and resist adding more." The six below are
 * that list, unextended. The resisting is the point - every extra tool is another thing
 * a connected agent has to understand before it can be useful, and the value here is
 * that any agent can pick this up in one read.
 *
 * The MCP protocol comes from the official SDK rather than being hand-rolled, which
 * departs from the zero-dependency posture `packages/ads` holds to. The reason is that
 * interop *is* this feature: a subtly wrong handshake does not throw, it just silently
 * fails to connect, which is the least debuggable outcome available.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MEMORY_KINDS } from "./names.ts";
import type { MemoryStore } from "./store.ts";
import type { SearchIndex } from "./searchIndex.ts";
import type { MemoryKind } from "./types.ts";

export const SERVER_NAME = "adcode-memory";
export const SERVER_VERSION = "0.1.0";

const KIND_ENUM = [...MEMORY_KINDS];

const TOOLS = [
  {
    name: "memory_search",
    description:
      "Search the project memory by full text. Returns matching memory names with a snippet showing why each matched.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to search for." },
        kind: { type: "string", enum: KIND_ENUM, description: "Restrict to one kind of memory." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum results (default 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description: "Read one memory in full, including its frontmatter and body.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "The memory's name." } },
      required: ["name"],
    },
  },
  {
    name: "memory_write",
    description:
      "Create or update one memory. One fact per memory. Use a short kebab-case name; updating an existing name replaces its body and records you as an agent that has touched it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short kebab-case identifier, e.g. chose-electron." },
        description: { type: "string", description: "One line summarising the fact." },
        type: { type: "string", enum: KIND_ENUM, description: "What kind of fact this is." },
        body: { type: "string", description: "The fact itself, in markdown. Link others with [[name]]." },
      },
      required: ["name", "description", "type", "body"],
    },
  },
  {
    name: "memory_list",
    description: "List every memory's name and description, optionally filtered by kind.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: KIND_ENUM, description: "Restrict to one kind." } },
    },
  },
  {
    name: "session_append",
    description:
      "Record what you just did and why, so the next agent does not re-tread your dead ends.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Your name, e.g. claude-code." },
        summary: { type: "string", description: "What you did and why." },
      },
      required: ["agent", "summary"],
    },
  },
  {
    name: "project_context",
    description: "The digest a fresh agent should read first. Call this before anything else.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

const text = (value: string): { content: Array<{ type: "text"; text: string }> } => ({
  content: [{ type: "text", text: value }],
});

const failure = (
  value: string,
): { content: Array<{ type: "text"; text: string }>; isError: true } => ({
  content: [{ type: "text", text: value }],
  isError: true,
});

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asKind(value: unknown): MemoryKind | undefined {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value)
    ? (value as MemoryKind)
    : undefined;
}

export interface MemoryMcpDeps {
  readonly store: MemoryStore;
  readonly index: SearchIndex;
  /** Rebuild the index from markdown. Called after every write, since markdown leads. */
  readonly reindex: () => Promise<void>;
}

export function createMemoryMcpServer(deps: MemoryMcpDeps): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (request.params.name) {
        case "memory_search": {
          const query = asString(args["query"]);
          if (query === null) return failure("memory_search requires a non-empty query.");

          const limit = typeof args["limit"] === "number" ? args["limit"] : undefined;
          const hits = deps.index.search(query, asKind(args["kind"]), limit);

          if (hits.length === 0) return text(`No memories match ${JSON.stringify(query)}.`);

          return text(
            hits
              .map((hit) => `- **${hit.name}** (${hit.type}) - ${hit.description}\n  ${hit.snippet}`)
              .join("\n"),
          );
        }

        case "memory_read": {
          const name = asString(args["name"]);
          if (name === null) return failure("memory_read requires a name.");

          const record = await deps.store.read(name);
          if (record === null) return failure(`No memory named ${JSON.stringify(name)}.`);

          return text(
            [
              `# ${record.name}`,
              `${record.description}`,
              ``,
              `type: ${record.type} · created: ${record.created} · agents: ${record.agents.join(", ") || "none"}`,
              ``,
              record.body,
            ].join("\n"),
          );
        }

        case "memory_write": {
          const name = asString(args["name"]);
          const description = asString(args["description"]);
          const kind = asKind(args["type"]);
          const body = typeof args["body"] === "string" ? args["body"] : null;

          if (name === null) return failure("memory_write requires a name.");
          if (description === null) return failure("memory_write requires a description.");
          if (kind === undefined) {
            return failure(`memory_write requires type to be one of: ${KIND_ENUM.join(", ")}.`);
          }
          if (body === null) return failure("memory_write requires a body.");

          const written = await deps.store.write({
            name,
            description,
            type: kind,
            body,
            agent: asString(args["agent"]) ?? undefined,
          });

          if (written === null) {
            return failure(
              `Could not write ${JSON.stringify(name)}. Names must be lowercase letters, digits, and hyphens.`,
            );
          }

          await deps.reindex();
          return text(`Wrote ${written.name} (${written.type}).`);
        }

        case "memory_list": {
          const summaries = await deps.store.list(asKind(args["kind"]));
          if (summaries.length === 0) return text("The project memory is empty.");

          return text(
            summaries.map((s) => `- **${s.name}** (${s.type}) - ${s.description}`).join("\n"),
          );
        }

        case "session_append": {
          const agent = asString(args["agent"]);
          const summary = asString(args["summary"]);

          if (agent === null) return failure("session_append requires an agent name.");
          if (summary === null) return failure("session_append requires a summary.");

          const record = await deps.store.appendSession(agent, summary);
          if (record === null) return failure(`Could not record a session for ${JSON.stringify(agent)}.`);

          await deps.reindex();
          return text(`Recorded in ${record.name}.`);
        }

        case "project_context":
          return text(await deps.store.projectContext());

        default:
          return failure(`Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      // A tool call must never take the server down: the agent on the other end would
      // lose the whole connection over one bad argument.
      return failure(`Tool failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return server;
}
